import { PrismaClient } from "@prisma/client";
import { dbQueriesCounter, dbQueryDurationHistogram } from "./metrics";

// Prevent multiple instances of Prisma Client in development
const globalForPrisma = global as unknown as { prisma: PrismaClient };

// Instantiate the base client
const basePrisma = globalForPrisma.prisma || new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = basePrisma;

// Apply the Metrics Extension
export const prisma = basePrisma.$extends({
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        // 1. Start timer with the specific model and operation names
        const endTimer = dbQueryDurationHistogram.startTimer({
          model,
          operation,
        });

        try {
          // 2. Execute the actual database query
          const result = await query(args);
          
          // 3. Record successful query count
          dbQueriesCounter.inc({ model, operation });
          
          return result;
        } finally {
          // 4. Stop the timer to record latency
          endTimer();
        }
      },
    },
  },
});