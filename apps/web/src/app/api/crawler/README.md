# 爬虫 API 文档

本目录包含用于 n8nworkflows.xyz 爬虫的 API 接口。

## API 接口列表

### 1. 获取分类列表

**路径**: `/api/crawler/categories`

**方法**: `GET`

**描述**: 返回所有可抓取的分类（激活状态的分类）

**认证**: 
- 如果配置了 `CRAWLER_API_TOKEN` 环境变量，需要 Bearer token 认证
- 如果未配置，则不需要认证（仅限开发环境）

**请求头**:
```
Authorization: Bearer YOUR_TOKEN
```

**响应示例**:
```json
{
  "success": true,
  "data": [
    {
      "id": "cat_xxx",
      "referenceId": "AI",
      "name": "AI",
      "nameEn": "AI",
      "slug": "ai",
      "description": "AI相关的工作流",
      "descriptionEn": "AI related workflows",
      "icon": null,
      "order": 1,
      "workflowCount": 100
    }
  ],
  "count": 1,
  "timestamp": "2025-01-13T10:00:00.000Z"
}
```

**使用示例**:
```bash
curl -X GET "http://localhost:30002/api/crawler/categories" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

### 2. 保存爬虫数据

**路径**: `/api/crawler/save`

**方法**: `POST`

**描述**: 保存从 n8nworkflows.xyz 抓取的工作流数据，包括作者信息和工作流信息

**认证**: 
- 如果配置了 `CRAWLER_API_TOKEN` 环境变量，需要 Bearer token 认证
- 如果未配置，则不需要认证（仅限开发环境）

**请求头**:
```
Authorization: Bearer YOUR_TOKEN
Content-Type: application/json
```

**请求体**:
```json
{
  "author": {
    "name": "Dr. Firas",
    "username": "drfiras",
    "avatar": "https://example.com/avatar.jpg",
    "verified": true,
    "description": "作者简介",
    "bio": "作者详细简介",
    "website": "https://example.com",
    "twitter": "https://twitter.com/xxx",
    "linkedin": "https://linkedin.com/in/xxx",
    "github": "https://github.com/xxx"
  },
  "workflow": {
    "referenceId": "5338",
    "slug": "generate-ai-viral-videos-5338",
    "title": "Generate AI Viral Videos",
    "description": "工作流描述",
    "descriptionEn": "Workflow description",
    "summary": "工作流摘要",
    "metaDescription": "SEO描述",
    "imageUrl": "https://example.com/thumbnail.jpg",
    "workflowUrl": "https://n8n.io/workflows/5338",
    "workflowJson": {
      "nodes": [],
      "connections": {}
    },
    "readme": "README内容",
    "priceType": "free",
    "priceAmount": "0",
    "complexity": "advanced",
    "categorySlugs": ["ai"],
    "metadata": {
      "popularity": 921,
      "visitors": 43587,
      "inserters": 17382
    }
  }
}
```

**响应示例**:
```json
{
  "success": true,
  "data": {
    "authorId": "auth_xxx",
    "workflowId": "workflow_xxx",
    "isNewAuthor": false,
    "isNewWorkflow": true
  },
  "message": "工作流已创建",
  "timestamp": "2025-01-13T10:00:00.000Z"
}
```

**使用示例**:
```bash
curl -X POST "http://localhost:30002/api/crawler/save" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "author": {
      "name": "Dr. Firas",
      "username": "drfiras",
      "verified": true
    },
    "workflow": {
      "referenceId": "5338",
      "slug": "generate-ai-viral-videos-5338",
      "title": "Generate AI Viral Videos",
      "priceType": "free",
      "categorySlugs": ["ai"]
    }
  }'
```

---

### 3. 触发指定分类和页数的爬取

**路径**: `/api/crawler/crawl`

**方法**: `POST` 或 `GET`

**描述**: 验证爬取参数并返回使用说明。实际爬取需要通过 `crawlee-api` 项目的 `WorkflowCrawler.crawlCategoryPage()` 方法执行。

**认证**: 
- 如果配置了 `CRAWLER_API_TOKEN` 环境变量，需要 Bearer token 认证
- 如果未配置，则不需要认证（仅限开发环境）

**请求参数** (查询参数):
- `categorySlug` (必填): 分类 slug，如 "ai"
- `page` (可选): 页码，从1开始，默认1
- `limit` (可选): 每页数量，默认10，最大50

**请求头**:
```
Authorization: Bearer YOUR_TOKEN
```

**响应示例**:
```json
{
  "success": true,
  "message": "参数验证成功。请使用 crawlee-api 项目的 WorkflowCrawler.crawlCategoryPage() 方法执行爬取。",
  "params": {
    "categorySlug": "ai",
    "categoryName": "AI",
    "categoryId": "cat_xxx",
    "page": 1,
    "limit": 10
  },
  "usage": {
    "description": "在 crawlee-api 项目中使用以下代码：",
    "code": "import { workflowCrawler } from './crawlers/workflow-crawler.js'\n\nconst result = await workflowCrawler.crawlCategoryPage('ai', 1, 10)\nconsole.log('爬取结果:', result)"
  },
  "timestamp": "2025-01-13T10:00:00.000Z"
}
```

**使用示例**:
```bash
# 使用 POST 方法
curl -X POST "http://localhost:30002/api/crawler/crawl?categorySlug=ai&page=1&limit=10" \
  -H "Authorization: Bearer YOUR_TOKEN"

# 使用 GET 方法
curl -X GET "http://localhost:30002/api/crawler/crawl?categorySlug=ai&page=2&limit=20" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**在 crawlee-api 项目中使用**:

```typescript
import { workflowCrawler } from './crawlers/workflow-crawler.js'

// 爬取 AI 分类的第 1 页，每页 10 条
const result = await workflowCrawler.crawlCategoryPage('ai', 1, 10)

console.log('爬取结果:', result)
// {
//   categorySlug: 'ai',
//   page: 1,
//   limit: 10,
//   totalWorkflows: 10,
//   successCount: 10,
//   failCount: 0,
//   workflows: [...]
// }
```

**注意事项**:
- 此 API 主要用于参数验证和提供使用说明
- 实际爬取操作需要在 `crawlee-api` 项目中执行
- `crawlee-api` 项目已经实现了 `crawlCategoryPage` 方法，支持指定分类和页数

## 功能特性

### 增量更新
- **作者**: 基于 `username` 判断是否存在，存在则更新，不存在则创建
- **工作流**: 基于 `referenceId` 判断是否存在，存在则更新，不存在则创建
- **统计数据保留**: 更新工作流时，保留本地统计数据（views, downloads, likes等）

### 分类关联
- 通过 `categorySlugs` 数组指定分类
- 自动匹配分类并创建关联关系
- 更新时会先删除旧关联，再创建新关联

### 节点类型提取
- 如果提供了 `workflowJson`，会自动提取节点类型
- 保存到 `workflow_nodes` 表中
- 更新时会先删除旧节点，再插入新节点

## 环境变量配置

在 `.env` 文件中配置：

```bash
# 爬虫 API 访问令牌（可选）
CRAWLER_API_TOKEN=your_secret_token_here
```

## 错误处理

### 认证失败
```json
{
  "error": "Unauthorized"
}
```
状态码: `401`

### 数据格式错误
```json
{
  "success": false,
  "error": "请求数据格式错误",
  "details": [
    {
      "path": ["workflow", "title"],
      "message": "Required"
    }
  ],
  "timestamp": "2025-01-13T10:00:00.000Z"
}
```
状态码: `400`

### 服务器错误
```json
{
  "success": false,
  "error": "错误信息",
  "timestamp": "2025-01-13T10:00:00.000Z"
}
```
状态码: `500`

