ALTER TABLE `project` ADD `subdomain` text;--> statement-breakpoint
CREATE UNIQUE INDEX `project_subdomain_unique` ON `project` (`subdomain`);