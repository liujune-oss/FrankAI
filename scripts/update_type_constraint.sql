-- 1. 移除旧的约束
ALTER TABLE public.activities DROP CONSTRAINT activities_type_check;

-- 2. 添加包含 'log' 的新约束
ALTER TABLE public.activities ADD CONSTRAINT activities_type_check CHECK (type IN ('task', 'event', 'reminder', 'log'));
