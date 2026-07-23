CREATE TABLE `food_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`entry_type` text DEFAULT 'food' NOT NULL,
	`food_id` text,
	`logged_date` text NOT NULL,
	`meal_slot` text,
	`amount_g` real,
	`amount_ml` real,
	`kcal` real,
	`protein_g` real,
	`carbs_g` real,
	`fat_g` real,
	`logged_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`food_id`) REFERENCES `foods`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `foods` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`barcode` text,
	`name` text NOT NULL,
	`brand` text,
	`kcal_per_100` real NOT NULL,
	`protein_per_100` real,
	`carbs_per_100` real,
	`fat_per_100` real,
	`serving_size_g` real,
	`source` text DEFAULT 'custom' NOT NULL,
	`off_last_fetched_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `nutrition_goals` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`effective_from` text NOT NULL,
	`kcal_target` integer NOT NULL,
	`protein_target_g` real,
	`carbs_target_g` real,
	`fat_target_g` real,
	`water_target_ml` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
