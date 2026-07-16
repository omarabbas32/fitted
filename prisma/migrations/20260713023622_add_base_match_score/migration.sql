-- AlterTable
ALTER TABLE `cvversion` ADD COLUMN `baseMatchScore` INTEGER NULL;

-- AlterTable
ALTER TABLE `setting` MODIFY `aiBaseUrl` VARCHAR(191) NOT NULL DEFAULT 'https://agentrouter.org';
