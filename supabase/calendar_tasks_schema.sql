-- ==========================================
-- Unified Activities Schema (Calendar & Tasks)
-- ==========================================

-- Unified Activities Table
CREATE TABLE IF NOT EXISTS public.activities (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL, -- references the user context (derived from JWT)
    
    -- Core Content
    title TEXT NOT NULL,
    description TEXT,
    
    -- Combined Type & Status
    type TEXT CHECK (type IN ('task', 'event', 'reminder')) NOT NULL DEFAULT 'task',
    status TEXT CHECK (status IN ('needs_action', 'in_process', 'completed', 'cancelled')) DEFAULT 'needs_action',
    priority TEXT CHECK (priority IN ('low', 'medium', 'high', 'urgent')) DEFAULT 'medium',
    
    -- Temporal Data
    -- A task has a due date (end_time), no start_time.
    -- An event has both start_time and end_time.
    -- A reminder might only have a start_time (when to alert).
    start_time TIMESTAMP WITH TIME ZONE,
    end_time TIMESTAMP WITH TIME ZONE,
    is_all_day BOOLEAN DEFAULT FALSE,
    
    -- Meta Data
    location TEXT,
    tags TEXT[] DEFAULT '{}',
    
    -- Audit Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    
    -- Constraints
    -- If both start and end exist, end must be >= start
    CONSTRAINT valid_time_range CHECK (start_time IS NULL OR end_time IS NULL OR end_time >= start_time)
);

-- Indexes for efficient querying
-- Query by time range
CREATE INDEX IF NOT EXISTS activities_time_idx ON public.activities (start_time, end_time);
-- Query by user
CREATE INDEX IF NOT EXISTS activities_user_idx ON public.activities (user_id);
-- Query pending tasks
CREATE INDEX IF NOT EXISTS activities_status_idx ON public.activities (status, type);

-- RLS policies for Activities
ALTER TABLE public.activities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own activities"
    ON public.activities FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own activities"
    ON public.activities FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own activities"
    ON public.activities FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own activities"
    ON public.activities FOR DELETE
    USING (auth.uid() = user_id);

-- Trigger function for updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
   NEW.updated_at = timezone('utc'::text, now()); 
   RETURN NEW;
END;
$$ language 'plpgsql';

-- Attach Trigger
DROP TRIGGER IF EXISTS trg_activities_updated_at ON public.activities;
CREATE TRIGGER trg_activities_updated_at
BEFORE UPDATE ON public.activities
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();
