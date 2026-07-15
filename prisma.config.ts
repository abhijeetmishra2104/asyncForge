import { defineConfig } from "@prisma/config";
import * as dotenv from "dotenv";

// Load environment variables from the .env file
dotenv.config();

export default defineConfig({
  datasource: {
    url: process.env.DATABASE_URL,
  },
});