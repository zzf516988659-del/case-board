-- 源文件看板:文档「板内显示名」(2026-06-20)。
-- 目标:AI 自动整理 / 人工右键给材料起一个干净、带类型前缀的中文名(如「证据-微信聊天记录」),
-- 在看板里替代杂乱的原始文件名。**纯元数据,绝不改磁盘原件**(铁律:不动用户原文件夹)。
--
-- display_name        : 显示名;NULL = 回退原始 filename。
-- display_name_source : 'user'(人工右键改名,永不被 AI 覆盖)/ 'ai_suggest'(AI 自动整理建议)。
ALTER TABLE documents ADD COLUMN display_name TEXT;
ALTER TABLE documents ADD COLUMN display_name_source TEXT;
