# MindLoom 分阶段整改任务

## 第一阶段：数据正确性与安全止血

请审查当前仓库，并只完成本阶段任务，不实现新的产品功能。

### 任务

1. 修复 Page 创建：

   * 创建 DTO 删除 workspaceId。
   * 后端根据 spaceId 查询真实 workspaceId。
   * parentPageId 必须属于同一 Space。
   * 增加跨 Workspace 污染测试。

2. 修复 Page 更新：

   * 使用数据库事务。
   * UPDATE WHERE 必须包含 contentVersion。
   * Revision、Page Update、Job Enqueue 在同一事务完成。
   * 旧版本返回 HTTP 409。
   * 增加两个并发保存请求的集成测试。

3. 修复附件上传：

   * 只信任 pageId。
   * 从 Page 反查 Space 和 Workspace。
   * 增加大小限制、文件名清洗和 MIME 检查。
   * 不允许路径穿越。

4. 修复 AI Provider：

   * 实现 `createAiProviderForContext`。
   * 所有调用通过 `resolveWorkspaceRuntimeConfig`。
   * local_only 同时限制 LLM 和 Embedding。
   * disabled 禁止 AI、Embedding、RAG 和 Wiki Job。

5. 修复 Job：

   * 增加 sourceVersion 和 dedupeKey。
   * 同一 Page 同类 pending/running Job 去重。
   * 旧版本任务执行前自动跳过。
   * 不得引入 Redis 或 BullMQ。

6. 修复 Session：

   * 使用持久化 Session 表和 opaque token。
   * 支持撤销当前 Session 和全部 Session。
   * 增加 CSRF 或严格 Origin 防护。

### 验收

* 跨 Workspace 污染测试通过。
* 并发保存只有一个请求成功。
* local_only 不访问云端 Provider。
* disabled Space 不产生 AI 请求。
* 登出后旧 Session 无法访问。
* lint、typecheck、test、build 全部通过。

完成后停止，不要开始下一阶段。

## 第二阶段：性能和工程边界重构

只在第一阶段通过后执行。

### 任务

1. 新增轻量 Page Tree API：

   * 不返回 contentJson 和 textContent。
   * 支持 parentPageId、position、hasChildren。
   * 完整正文由 Page Detail API 获取。

2. 前端页面树：

   * 使用轻量 API。
   * 支持长列表虚拟化或按层级懒加载。
   * 页面编辑后只更新当前节点，不刷新整棵树。

3. Job 性能：

   * Embedding 批量请求。
   * Chunk 批量 INSERT。
   * 指数退避。
   * Job 指标和失败日志。

4. 搜索：

   * 使用 AbortController 取消旧请求。
   * 关键词搜索和语义搜索采用不同 debounce。
   * 增加 Query Embedding 缓存。
   * 不在每次键盘输入后立即调用远程 Embedding。

5. 轮询：

   * 页面不可见时停止轮询。
   * 无任务时降低频率。
   * 有 Job 时临时提高频率。
   * 为后续 SSE 状态推送预留接口。

6. 工程结构：

   * 后端拆为 route/service/repository。
   * 前端拆分 App.tsx。
   * 删除仓库中的 dist。
   * 增加 CI 质量门禁。

### 验收

* Page Tree 响应不包含正文。
* 10,000 个 Page Tree 节点不会造成明显卡顿。
* 连续输入搜索时旧请求被取消。
* 同一长页面处理不会逐 Chunk 单独写数据库。
* App.tsx 不再承载多个业务域。

## 第三阶段：产品信息架构与基础体验

只做 UI 架构，不做新的高级编辑器块。

### 任务

1. 建立稳定三栏 App Shell：

   * 左侧：知识库、最近、收藏、空间、页面树。
   * 中间：文档编辑区。
   * 右侧：AI、大纲、反向链接、页面信息。

2. 新增首页：

   * 最近编辑。
   * 收藏页面。
   * 待整理数量。
   * 快速记录。
   * 导入入口。
   * 最近问答。

3. 顶部栏：

   * 面包屑。
   * Command Palette。
   * 保存状态。
   * 分享。
   * 更多菜单。

4. 统一状态：

   * Skeleton。
   * Empty State。
   * Error State。
   * Toast。
   * Dialog。
   * Undo。

5. 不使用浏览器原生 alert 和 confirm。

6. 用户界面避免出现 RAG、Embedding、Graph Edge 等技术术语。

### 验收

* 用户登录后能够立即理解在哪里写笔记。
* Notes、智能整理和搜索不再像三个独立 Demo。
* 当前页面始终保持在主编辑区。
* 所有异步操作有清晰反馈。

## 第四阶段：编辑器产品化

### 任务

1. 顶部工具栏简化。
2. Slash Menu 成为主要插入入口。
3. 增加 Bubble Menu。
4. 增加 Block Handle 和拖拽排序。
5. 支持 Markdown 快捷输入。
6. 粘贴 URL 时自动判断链接、Embed 或媒体。
7. 图片支持拖入、粘贴、上传进度、取消和重试。
8. 实现本地草稿恢复。
9. 实现版本冲突恢复界面。
10. 高级块遵守统一 Extension Contract。

### 验收

* 默认编辑界面视觉安静。
* 常用操作可通过键盘完成。
* 编辑过程中不会因自动保存打断输入。
* 上传失败不会丢失当前文档。
* 刷新页面后可以恢复未提交草稿。

## 第五阶段：AI 可信体验

### 任务

1. 页面右侧 AI 面板：

   * 摘要。
   * 标签。
   * 相关页面。
   * 主题建议。
   * 问当前页面。

2. RAG 使用真正流式 SSE：

   * sources。
   * token。
   * citation。
   * done。
   * error。

3. 引用必须可点击回到具体页面和 Chunk。

4. AI 建议展示：

   * 将改变什么。
   * 为什么建议。
   * 来源证据。
   * 风险等级。
   * 接受、忽略、撤销。

5. Topic 来源更新后显示 stale，而不是静默覆盖。

6. Review Center 支持批量接受低风险建议。

### 验收

* 回答先出现来源，再逐步出现内容。
* 用户能判断答案来自哪里。
* AI 不会静默修改用户正文。
* 所有自动修改均可撤销。
* 无相关资料时明确拒答。
