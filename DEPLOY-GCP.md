# Deploying AsyncForge to GCP

**Option A — cheapest setup that still genuinely demonstrates Kubernetes.**

One GKE Autopilot cluster in `asia-south1` running the three stateless app
workloads at 1 replica each. Everything stateful is a managed free tier:
Postgres on Neon, RabbitMQ on CloudAMQP. Images live in Artifact Registry, and
GitHub Actions deploys on every green build of `main` with no service-account
key anywhere.

```
git push main → CI (typecheck/lint/build) → Deploy to GKE
                                              ├── build 3 images → Artifact Registry
                                              ├── prisma migrate deploy (Job)
                                              └── kubectl apply -k overlays/gcp

  in-cluster:  web ×1    dispatcher ×1    worker ×1
  managed:     Neon (Postgres)    CloudAMQP (RabbitMQ)
```

`overlays/local` is untouched — kind still runs the full stack including the
RabbitMQ StatefulSet, Prometheus and Grafana, for free.

---

## 1. One-time local setup

```bash
brew install --cask google-cloud-sdk
brew install hashicorp/tap/terraform   # not homebrew-core, HashiCorp moved it

# the cask does not touch PATH for you:
echo 'export PATH="/opt/homebrew/share/google-cloud-sdk/bin:$PATH"' >> ~/.zshrc
exec zsh

gcloud auth login
gcloud auth application-default login   # this is what Terraform uses
```

Create the project and attach billing (the $300 trial credit lives on your
billing account, not the project):

```bash
gcloud projects create asyncforge-<random-suffix> --name=AsyncForge
gcloud config set project asyncforge-<random-suffix>

gcloud billing accounts list
gcloud billing projects link asyncforge-<random-suffix> --billing-account=<ACCOUNT_ID>
```

Set a budget alert while you're in there — Billing → Budgets & alerts, $300 cap
with alerts at 50/90/100%. The credit does not hard-stop spending on its own.

## 2. Managed dependencies

**Postgres** — you already have Neon. Nothing to do.

**RabbitMQ** — create a free "Little Lemur" instance at
[cloudamqp.com](https://www.cloudamqp.com/plans.html), region as close to
`asia-south1` as they offer. Copy the `amqps://` URL from the instance page.

Free tier limits vs. what this app uses:

| Limit | Free tier | AsyncForge |
|---|---|---|
| Connections | 20 | ~3 (one per pod) |
| Queues | 100 | ~8 (2 exchanges' queues + retry queues) |
| Messages/month | 1,000,000 | a demo won't come close |
| Queued messages | 10,000 | fine unless you stress-test hard |

⚠️ **Verify quorum queues work on the shared broker.** `lib/rabbitmq.ts`
asserts `asyncforge.tasks.process` with `x-queue-type: quorum`, and CloudAMQP's
docs don't confirm shared plans allow it. If the worker logs a
`PRECONDITION_FAILED` or `queue type not allowed` error on startup, flip
`RABBITMQ_QUEUE_TYPE` in `kubernetes/base/configmap.yaml` to `"classic"` and
redeploy — no code change needed. Queue type is immutable, so delete the
existing queue in the CloudAMQP management UI first.

## 3. Infrastructure with Terraform

```bash
cd terraform
cp terraform.tfvars.example terraform.tfvars   # fill in project_id + github_repository
terraform init
terraform plan
terraform apply
```

This creates:

| Resource | Why |
|---|---|
| Enabled APIs | container, artifactregistry, compute, iamcredentials, sts |
| Artifact Registry repo | holds `web`, `worker`, `dispatcher`; keeps the last 10 tags |
| GKE Autopilot cluster | regional (Autopilot always is), REGULAR release channel |
| Workload Identity pool + provider | lets *only* your GitHub repo authenticate |
| `asyncforge-deployer` service account | `artifactregistry.writer` + `container.developer` |

First apply takes ~10 minutes, almost all of it the cluster. When it finishes:

```bash
terraform output github_actions_setup
```

That prints every value you need for the next step.

## 4. GitHub configuration

**Settings → Secrets and variables → Actions**

Variables:

| Name | Value |
|---|---|
| `GCP_PROJECT_ID` | your project ID |
| `GCP_REGION` | `asia-south1` |
| `GKE_CLUSTER` | `asyncforge` |
| `AR_REPOSITORY` | `asyncforge` |

Secrets:

| Name | Value |
|---|---|
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | from `terraform output` |
| `GCP_SERVICE_ACCOUNT` | from `terraform output` |
| `DATABASE_URL` | your Neon connection string |
| `RABBITMQ_URL` | your CloudAMQP `amqps://` URL |
| `GEMINI_API_KEY` | your Gemini key |

`RABBITMQ_DEFAULT_USER` / `RABBITMQ_DEFAULT_PASS` are only read by the
in-cluster broker, which this overlay doesn't deploy. Leave them unset.

## 5. Deploy

Push to `main`, or run **Actions → Deploy to GKE → Run workflow**. The workflow
builds the three images tagged with the commit SHA, pushes them, generates the
Kubernetes Secret from the GitHub secrets, runs `prisma migrate deploy` as a
Job, applies the overlay, and waits for the rollouts.

Find the app:

```bash
gcloud container clusters get-credentials asyncforge --region asia-south1
kubectl get svc web-service -n asyncforge   # EXTERNAL-IP, takes a minute on first deploy
```

---

## Custom domain: app.asyncforge.me

The app is reachable on the reserved static IP `34.47.179.34`
(`google_compute_address.web` in Terraform, pinned as `spec.loadBalancerIP` in
`patch-web-service.yaml`). Because it is reserved rather than ephemeral, the
address survives a Service delete or a full cluster teardown, so the DNS record
below does not need updating after a rebuild.

TLS terminates at Cloudflare's edge, which costs nothing and avoids running a
cert on the cluster:

```
browser --HTTPS--> Cloudflare edge --HTTP--> 34.47.179.34 (GCP L4 LB) --> web pod
```

**Cloudflare setup (one time)**

1. Add `asyncforge.me` as a site on the Cloudflare free plan.
2. Cloudflare gives you two nameservers. In Namecheap → Domain → Nameservers,
   switch to **Custom DNS** and enter them. Propagation is usually minutes.
3. In Cloudflare → DNS, add:

   | Type | Name  | Content        | Proxy  |
   |------|-------|----------------|--------|
   | A    | `app` | `34.47.179.34` | Proxied (orange) |

   The orange cloud is what does the work — grey-clouded, DNS resolves
   straight to GCP and you get plain HTTP with no certificate.
4. SSL/TLS → Overview → set the mode to **Flexible**. The origin has no
   certificate, so Full or Strict would fail. This means the Cloudflare→GCP
   hop is unencrypted inside Google's network; fine for a demo, and the fix
   later is a cert on the origin plus Full mode.

The apex `asyncforge.me` is left alone, so a GitHub Pages site can keep it.
Pages needs its own records at the apex — keep them grey-clouded (DNS only),
since Pages terminates its own TLS.

**Verify**

```bash
dig +short app.asyncforge.me          # Cloudflare edge IPs, not 34.47.179.34
curl -sI https://app.asyncforge.me | head -3
```

Seeing Cloudflare's IPs rather than the GCP one is the proxy working, not a
misconfiguration.

---

## What the GCP overlay changes

`kubernetes/overlays/gcp` shares a base with `overlays/local`, with these
deliberate differences:

1. **Images** point at Artifact Registry and are pinned to a commit SHA, never
   `:latest`. Rollbacks are `kubectl rollout undo`.
2. **Explicit resource requests on everything.** Autopilot bills per Pod
   request and silently defaults to 0.5 vCPU / 2 GiB *per container* if you
   omit them — that default alone would roughly triple the bill.
3. **Spot Pods** (`cloud.google.com/gke-spot`) for roughly a third of the price.
   GCP can reclaim a Pod with 25 seconds' notice, which is survivable by
   design here: an interrupted worker never ACKs its RabbitMQ message, so the
   job is redelivered to another worker.
4. **`web-service` is a LoadBalancer** instead of the kind ingress, which is
   hardcoded to `host: localhost`.
5. **RabbitMQ, Prometheus and Grafana are not deployed.** Both are one
   uncommented line away in `kustomization.yaml` if you want them back.

Worker replicas are 1. Scale up when you want to demo the queue draining, then
scale back down:

```bash
kubectl scale deploy/asyncforge-worker -n asyncforge --replicas=5
# ...demo the backlog draining, then:
kubectl scale deploy/asyncforge-worker -n asyncforge --replicas=1
```

That scale command *is* the demo — it's the thing that makes "independently
scalable workers" concrete rather than a claim on a slide.

Observability: Autopilot ships metrics and logs to Cloud Monitoring/Logging by
default, so pod CPU, memory, restarts and logs are in the console for free. The
Prometheus + Grafana dashboards still run on kind via `overlays/local`, which is
where the screenshots in `docs/` came from.

## Cost against the $300

Rough monthly figures for `asia-south1`; treat them as ±20%.

| Item | Monthly |
|---|---|
| Autopilot cluster fee | $0 — the GKE free tier credit ($74.40/mo) covers one cluster |
| Pods: 1.0 vCPU + 2 GiB, all Spot | ~$19 |
| Load balancer forwarding rule | ~$18 |
| Artifact Registry + egress | ~$2 |
| Neon + CloudAMQP | $0 (free tiers) |
| **Total** | **~$39/mo → ~$117 for the full 90 days** |

Two levers if you want it cheaper still:

- **Drop the public IP (~$18/mo, nearly half the bill).** Change
  `patch-web-service.yaml` back to `type: ClusterIP` and demo over
  `kubectl port-forward -n asyncforge svc/web-service 3000:80`. That takes you
  to ~$21/mo.
- **Delete the cluster between demos.** This is the only thing that really
  stops the meter:

  ```bash
  cd terraform && terraform destroy -target=google_container_cluster.autopilot
  ```

  Re-creating it is one `terraform apply` (~10 min) plus one re-run of the
  deploy workflow. Artifact Registry, IAM and the WIF trust all survive, so
  nothing needs reconfiguring.

**What would blow the budget:** Cloud SQL (~$25/mo minimum — hence Neon), a
second cluster (the free tier covers one), a regional Standard cluster, and
GCE Ingress with Cloud Armor.

## Troubleshooting

**Pods stuck `Pending` with "no nodes available"** — spot capacity ran dry in
the region. Delete the `nodeSelector` block from the relevant patch in
`kubernetes/overlays/gcp/` and re-apply; you pay full price but you run.

**Worker crash-looping on `PRECONDITION_FAILED`** — the broker rejected the
quorum queue. See the CloudAMQP note in step 2.

**`Error: denied: Permission artifactregistry.repositories.uploadArtifacts`** —
the WIF trust is wrong. Check `github_repository` in `terraform.tfvars` exactly
matches `owner/name`, and that the workflow has `permissions: id-token: write`.

**Migration Job fails** — almost always `DATABASE_URL`. Check the logs the
failure step dumped, or run `kubectl logs job/prisma-migrate -n asyncforge`.
Neon needs `?sslmode=require` on the connection string.

**`ImagePullBackOff`** — the node service account cannot read the registry.
`terraform apply` again; the `nodes_can_pull` IAM binding grants it.
