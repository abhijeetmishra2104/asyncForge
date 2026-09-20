# ---------------------------------------------------------------------------
# Alerting
# ---------------------------------------------------------------------------
# Until now nothing would have noticed if jobs started failing: the Prometheus
# and Grafana manifests only run on kind, and nobody watches a dashboard.
#
# Google Managed Service for Prometheus scrapes the worker and dispatcher
# /metrics endpoints (see kubernetes/monitoring/podmonitoring.yaml), so these
# policies can alert on the application's own counters without running a
# Prometheus of our own.

resource "google_monitoring_notification_channel" "email" {
  display_name = "AsyncForge alerts"
  type         = "email"

  labels = {
    email_address = var.alert_email
  }
}

/**
 * Jobs are reaching FAILED, which means a task was retried to exhaustion and
 * dead-lettered. One is worth knowing about; a stream of them means Gemini,
 * the database, or a deploy is broken.
 */
resource "google_monitoring_alert_policy" "jobs_failing" {
  display_name = "AsyncForge: jobs are failing"
  combiner     = "OR"
  severity     = "ERROR"

  conditions {
    display_name = "failed jobs over the last 5 minutes"

    condition_prometheus_query_language {
      query               = "sum(rate(asyncforge_jobs_processed_total{status=\"failed\"}[5m])) > 0.016"
      duration            = "300s"
      evaluation_interval = "60s"
    }
  }

  notification_channels = [google_monitoring_notification_channel.email.id]

  documentation {
    content = <<-EOT
      More than one job per minute has failed for five minutes straight.

      Check the workers first: `kubectl logs -n asyncforge deploy/asyncforge-worker --tail=50`.
      A job only reaches FAILED after exhausting MAX_JOB_ATTEMPTS, and its
      message is then dead-lettered to asyncforge.tasks.dlq, where it can be
      inspected in the CloudAMQP console.
    EOT
  }
}

/**
 * The outbox is filling up faster than the dispatcher drains it. Either the
 * dispatcher is down, or it cannot reach RabbitMQ — tasks are being accepted
 * and durably stored, but never published, so nothing is being processed.
 */
resource "google_monitoring_alert_policy" "outbox_backlog" {
  display_name = "AsyncForge: outbox is not draining"
  combiner     = "OR"
  severity     = "ERROR"

  conditions {
    display_name = "pending outbox events staying high"

    condition_prometheus_query_language {
      query               = "max(asyncforge_outbox_pending_events) > 50"
      duration            = "600s"
      evaluation_interval = "60s"
    }
  }

  notification_channels = [google_monitoring_notification_channel.email.id]

  documentation {
    content = <<-EOT
      More than 50 outbox events have been waiting for ten minutes.

      The API is still accepting work — nothing is lost — but no task is being
      published to RabbitMQ. Check the dispatcher:
      `kubectl logs -n asyncforge deploy/asyncforge-dispatcher --tail=50`.

      Common causes: the broker is unreachable, or a dispatcher died holding
      claims (those expire after OUTBOX_CLAIM_TIMEOUT_MS and are retried).
    EOT
  }
}

/**
 * Containers restarting repeatedly. Catches what the application's own metrics
 * cannot: a crash loop on boot, an OOM kill, or a bad image — cases where the
 * process never gets far enough to report anything.
 */
resource "google_monitoring_alert_policy" "containers_restarting" {
  display_name = "AsyncForge: containers are restarting"
  combiner     = "OR"
  severity     = "WARNING"

  conditions {
    display_name = "restarts in the last 10 minutes"

    condition_threshold {
      filter = join(" AND ", [
        "resource.type = \"k8s_container\"",
        "resource.labels.namespace_name = \"asyncforge\"",
        "metric.type = \"kubernetes.io/container/restart_count\"",
      ])
      comparison      = "COMPARISON_GT"
      threshold_value = 3
      duration        = "0s"

      aggregations {
        alignment_period     = "600s"
        per_series_aligner   = "ALIGN_DELTA"
        cross_series_reducer = "REDUCE_SUM"
        group_by_fields      = ["resource.labels.container_name"]
      }
    }
  }

  notification_channels = [google_monitoring_notification_channel.email.id]

  documentation {
    content = <<-EOT
      A container restarted more than three times in ten minutes.

      `kubectl get pods -n asyncforge` and then
      `kubectl logs -n asyncforge <pod> --previous` to see why it died.

      Note that workers run on Spot nodes, so an occasional restart is normal
      and expected — a shutting-down worker hands its in-flight jobs back.
      Repeated restarts are not.
    EOT
  }
}
