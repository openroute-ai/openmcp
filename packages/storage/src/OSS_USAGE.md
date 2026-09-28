# 阿里云OSS使用指南

本文档介绍如何在项目中使用阿里云OSS进行文件存储。

## 配置步骤

### 1. 安装依赖

项目已经包含了`ali-oss`依赖，无需额外安装。

### 2. 环境变量配置

在`.env.local`文件中添加以下配置：

```bash
# 阿里云OSS配置
STORAGE_REGION=cn-hangzhou
STORAGE_BUCKET_NAME=your-bucket-name
STORAGE_ACCESS_KEY_ID=your-access-key-id
STORAGE_SECRET_ACCESS_KEY=your-access-key-secret
STORAGE_ENDPOINT=https://oss-cn-hangzhou.aliyuncs.com
STORAGE_PUBLIC_URL=https://your-cdn-domain.com
STORAGE_OSS_INTERNAL=false
STORAGE_OSS_SECURE=true
```

### 3. 修改网站配置

在`src/config/website.tsx`中修改storage provider：

```typescript
export const websiteConfig: WebsiteConfig = {
  // ... other config
  storage: {
    provider: 'oss', // 改为oss
  },
  // ... other config
};
```

## 使用示例

### 服务端上传

```typescript
import { uploadFile, deleteFile, getPresignedUploadUrl } from '@/storage';

// 上传文件
const { url, key } = await uploadFile(
  fileBuffer,
  'original-filename.jpg',
  'image/jpeg',
  'uploads/images'
);

// 删除文件
await deleteFile(key);

// 生成预签名URL
const { url, key } = await getPresignedUploadUrl(
  'filename.jpg',
  'image/jpeg',
  'uploads/images'
);
```

### 客户端上传

```typescript
'use client';

import { uploadFileFromBrowser } from '@/storage';

async function handleFileUpload(event) {
  const file = event.target.files[0];
  
  try {
    const { url, key } = await uploadFileFromBrowser(file, 'uploads/images');
    console.log('File uploaded:', url);
  } catch (error) {
    console.error('Upload failed:', error);
  }
}
```

## 配置说明

### 环境变量

- `STORAGE_REGION`: OSS区域，如`cn-hangzhou`、`cn-beijing`等
- `STORAGE_BUCKET_NAME`: OSS存储桶名称
- `STORAGE_ACCESS_KEY_ID`: 阿里云AccessKey ID
- `STORAGE_SECRET_ACCESS_KEY`: 阿里云AccessKey Secret
- `STORAGE_ENDPOINT`: OSS服务端点
- `STORAGE_PUBLIC_URL`: 自定义CDN域名（可选）
- `STORAGE_OSS_INTERNAL`: 是否使用内网端点（可选，默认false）
- `STORAGE_OSS_SECURE`: 是否使用HTTPS（可选，默认true）

### 区域列表

常用的OSS区域包括：
- `cn-hangzhou`: 华东1（杭州）
- `cn-shanghai`: 华东2（上海）
- `cn-qingdao`: 华北1（青岛）
- `cn-beijing`: 华北2（北京）
- `cn-zhangjiakou`: 华北3（张家口）
- `cn-huhehaote`: 华北5（呼和浩特）
- `cn-wulanchabu`: 华北6（乌兰察布）
- `cn-shenzhen`: 华南1（深圳）
- `cn-heyuan`: 华南2（河源）
- `cn-guangzhou`: 华南3（广州）
- `cn-chengdu`: 西南1（成都）
- `cn-hongkong`: 中国香港

## 注意事项

1. **安全性**: 请确保AccessKey具有适当的权限，建议使用RAM用户
2. **内网访问**: 如果服务器在阿里云ECS上，可以设置`STORAGE_OSS_INTERNAL=true`以获得更好的性能
3. **HTTPS**: 建议设置`STORAGE_OSS_SECURE=true`以确保传输安全
4. **CDN**: 可以配置自定义域名作为`STORAGE_PUBLIC_URL`以获得更好的访问性能

## 故障排除

### 常见错误

1. **配置错误**: 检查环境变量是否正确设置
2. **权限错误**: 确保AccessKey具有OSS操作权限
3. **网络错误**: 检查网络连接和防火墙设置
4. **区域错误**: 确保区域设置正确

### 调试

启用详细日志：

```typescript
// 在开发环境中可以查看控制台日志
console.log('Storage provider:', getStorageProvider().getProviderName());
```
