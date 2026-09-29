# LiteLLM 管理器

这个模块提供了对 LiteLLM API 的 TypeScript 封装，包含客户管理、内部用户管理、消费管理和密钥管理等功能。

## 环境变量配置

支持通过环境变量配置 LiteLLM 连接信息：

```bash
# LiteLLM 主密钥（必需）
LITELLM_MASTER_KEY=your_master_key_here

# LiteLLM 基础 URL（可选，默认为 http://0.0.0.0:4000）
LITELLM_BASE_URL=http://your-litellm-server:4000
```

## 使用方法

### 1. 客户管理

```typescript
import { LiteLLMCustomerManager } from "@repo/trpc/lib/litellm";

// 使用环境变量配置
const customerManager = new LiteLLMCustomerManager();

// 或者手动传入配置
const customerManager = new LiteLLMCustomerManager(
  "your_master_key",
  "http://your-server:4000"
);

// 创建客户
const customer = await customerManager.createCustomer({
  user_id: "user123",
  alias: "测试用户",
  max_budget: 100,
  budget_duration: "monthly",
});

// 获取客户信息
const userInfo = await customerManager.getEndUserInfo("user123");
```

### 2. 内部用户管理

```typescript
import { LiteLLMInternalUserManager } from "@repo/trpc/lib/litellm";

const userManager = new LiteLLMInternalUserManager();

// 创建内部用户
const user = await userManager.createInternalUser({
  user_id: "internal_user_123",
  user_alias: "内部用户",
  user_role: "internal_user",
  max_budget: 500,
});

// 获取用户每日活动
const activity = await userManager.getUserDailyActivity({
  user_id: "internal_user_123",
  start_date: "2024-01-01",
  end_date: "2024-01-31",
});
```

### 3. 消费管理

```typescript
import { LiteLLMSpendingManager } from "@repo/trpc/lib/litellm";

const spendingManager = new LiteLLMSpendingManager();

// 获取全局消费报告
const report = await spendingManager.getGlobalSpendReport({
  start_date: "2024-01-01",
  end_date: "2024-01-31",
  group_by: "team",
});

// 获取消费日志
const logs = await spendingManager.getSpendLogs({
  user_id: "user123",
  start_date: "2024-01-01",
  end_date: "2024-01-31",
});

// 计算消费
const cost = await spendingManager.calculateSpend({
  model: "gpt-4",
  messages: [{ role: "user", content: "Hello" }],
});
```

### 4. 密钥管理

```typescript
import { LiteLLMKeyManager } from "@repo/trpc/lib/litellm";

const keyManager = new LiteLLMKeyManager();

// 生成密钥
const key = await keyManager.generateKey({
  user_id: "user123",
  key_alias: "测试密钥",
  max_budget: 100,
  duration: "30d",
});

// 更新密钥
await keyManager.updateKey("key_123", {
  max_budget: 200,
  blocked: false,
});

// 删除密钥
await keyManager.deleteKeys({
  keys: ["key_123"],
  key_aliases: ["测试密钥"],
});
```

## 类型安全

所有方法都提供了完整的 TypeScript 类型支持：

```typescript
import type {
  CreateCustomerParams,
  EndUserInfo,
  CreateInternalUserParams,
  GlobalSpendReportParams,
} from "@repo/trpc/lib/litellm";

// 使用类型
const params: CreateCustomerParams = {
  user_id: "user123",
  max_budget: 100,
};
```

## 错误处理

所有 API 调用都会抛出标准的 Error 对象：

```typescript
try {
  const customer = await customerManager.createCustomer(params);
} catch (error) {
  console.error("创建客户失败:", error.message);
}
```

## 配置优先级

配置参数的优先级如下：

1. 构造函数传入的参数
2. 环境变量
3. 默认值

```typescript
// 优先级：构造函数参数 > 环境变量 > 默认值
const manager = new LiteLLMCustomerManager(
  "custom_key",
  "http://custom-url:4000"
);
```

## 注意事项

1. **必需配置**: `LITELLM_MASTER_KEY` 是必需的，如果没有提供会抛出错误
2. **网络请求**: 所有操作都是异步的，需要适当的错误处理
3. **类型安全**: 建议使用 TypeScript 以获得完整的类型支持
4. **环境变量**: 在生产环境中建议使用环境变量而不是硬编码配置
