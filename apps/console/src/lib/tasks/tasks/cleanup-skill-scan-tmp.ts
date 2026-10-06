import { cleanupOldSkillScanDirs } from "@/lib/skill-scan"

/** Shape of the task's return value; `Task.run` widens it to a record. */
export interface CleanupSkillScanTmpTaskResult {
  cleaned: number
}

export function createCleanupSkillScanTmpTask() {
  return {
    name: "cleanup-skill-scan-tmp",
    description: "Clean up old skill scan temporary directories",
    cronExpression: "0 3 * * *", // daily at 03:00 Asia/Shanghai (schedule handled centrally)
    taskType: "daily" as const,
    isDaily: true,
    async run(): Promise<Record<string, unknown>> {
      const cleaned = await cleanupOldSkillScanDirs()
      return { cleaned }
    },
  }
}