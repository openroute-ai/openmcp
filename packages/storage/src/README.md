# Storage Module

This module provides a unified interface for storing and retrieving files using various cloud storage providers. Currently, it supports Amazon S3, compatible services like Cloudflare R2, and Alibaba Cloud OSS.

## Features

- Upload files to cloud storage
- Generate pre-signed URLs for direct browser-to-storage uploads
- Delete files from storage
- Client-side upload helpers for both small and large files

## Basic Usage

The API is the same for all supported providers (S3, Cloudflare R2, and Alibaba Cloud OSS):

```typescript
import { uploadFile, deleteFile, getPresignedUploadUrl } from '@/storage';

// Upload a file
const { url, key } = await uploadFile(
  fileBuffer,
  'original-filename.jpg',
  'image/jpeg',
  'uploads/images'
);

// Delete a file
await deleteFile(key);

// Generate a pre-signed URL for direct upload
const { url, key } = await getPresignedUploadUrl(
  'filename.jpg',
  'image/jpeg',
  'uploads/images'
);
```

### Switching Between Providers

To switch between providers, simply change the configuration:

```typescript
// For S3/Cloudflare R2
export const websiteConfig = {
  storage: {
    provider: 's3',
  },
};

// For Alibaba Cloud OSS
export const websiteConfig = {
  storage: {
    provider: 'oss',
  },
};
```

## Client-Side Upload

For client-side uploads, use the `uploadFileFromBrowser` function:

```typescript
'use client';

import { uploadFileFromBrowser } from '@/storage';

// In your component
async function handleFileUpload(event) {
  const file = event.target.files[0];
  
  try {
    // This will automatically use the most appropriate upload method
    // based on the file size
    const { url, key } = await uploadFileFromBrowser(file, 'uploads/images');
    console.log('File uploaded:', url);
  } catch (error) {
    console.error('Upload failed:', error);
  }
}
```

## Configuration

The storage module is configured in two ways:

1. In `src/config/website.tsx`:

```typescript
// In src/config/website.tsx
export const websiteConfig = {
  // ...other config
  storage: {
    provider: 's3', // or 'oss' for Alibaba Cloud OSS
  },
  // ...other config
}
```

2. Using environment variables:

### For S3/Cloudflare R2:
```
# Required
STORAGE_REGION=us-east-1
STORAGE_ACCESS_KEY_ID=your-access-key
STORAGE_SECRET_ACCESS_KEY=your-secret-key
STORAGE_BUCKET_NAME=your-bucket-name
STORAGE_ENDPOINT=https://custom-endpoint.com
STORAGE_PUBLIC_URL=https://cdn.example.com
STORAGE_FORCE_PATH_STYLE=true
```

### For Alibaba Cloud OSS:
```
# Required
STORAGE_REGION=cn-hangzhou
STORAGE_ACCESS_KEY_ID=your-access-key-id
STORAGE_SECRET_ACCESS_KEY=your-access-key-secret
STORAGE_BUCKET_NAME=your-bucket-name
STORAGE_ENDPOINT=https://oss-cn-hangzhou.aliyuncs.com
STORAGE_PUBLIC_URL=https://your-cdn-domain.com
# OSS specific configurations
STORAGE_OSS_INTERNAL=false  # Use internal endpoint for better performance
STORAGE_OSS_SECURE=true     # Use HTTPS (recommended)
```

## Advanced Usage

### Using the Storage Provider Directly

If you need more control, you can interact with the storage provider directly:

```typescript
import { getStorageProvider } from '@/storage';

const provider = getStorageProvider();

// Use provider methods directly
const result = await provider.uploadFile({
  file: fileBuffer,
  filename: 'example.pdf',
  contentType: 'application/pdf',
  folder: 'documents'
});
```

### Using a Custom Provider Implementation

You can create and use your own storage provider implementation:

```typescript
import { StorageProvider, UploadFileParams, UploadFileResult } from '@/storage/types';

class CustomStorageProvider implements StorageProvider {
  // Implement the required methods
  async uploadFile(params: UploadFileParams): Promise<UploadFileResult> {
    // Your implementation
    return { url: 'https://example.com/file.jpg', key: 'file.jpg' };
  }

  async deleteFile(key: string): Promise<void> {
    // Your implementation
  }

  async getPresignedUploadUrl(params: PresignedUploadUrlParams): Promise<PresignedUploadUrlResult> {
    // Your implementation
    return { url: 'https://example.com/upload', key: 'file.jpg' };
  }

  getProviderName(): string {
    return 'CustomProvider';
  }
}

// Then use it
const customProvider = new CustomStorageProvider();
const result = await customProvider.uploadFile({
  file: fileBuffer,
  filename: 'example.jpg',
  contentType: 'image/jpeg'
});
```

## Quick Start

### For Alibaba Cloud OSS

1. **Configure environment variables**:
```bash
STORAGE_REGION=cn-hangzhou
STORAGE_BUCKET_NAME=your-bucket-name
STORAGE_ACCESS_KEY_ID=your-access-key-id
STORAGE_SECRET_ACCESS_KEY=your-access-key-secret
STORAGE_ENDPOINT=https://oss-cn-hangzhou.aliyuncs.com
```

2. **Update website config**:
```typescript
// src/config/website.tsx
export const websiteConfig = {
  storage: {
    provider: 'oss',
  },
};
```

3. **Use the API**:
```typescript
import { uploadFile } from '@/storage';

const { url, key } = await uploadFile(
  fileBuffer,
  'image.jpg',
  'image/jpeg',
  'uploads'
);
```

## Supported Providers

### Amazon S3 / Cloudflare R2
- Compatible with Amazon S3 and S3-compatible services
- Supports custom endpoints for services like Cloudflare R2
- Uses AWS SDK v3 for optimal performance

### Alibaba Cloud OSS
- Native support for Alibaba Cloud Object Storage Service
- Supports internal endpoints for better performance
- Configurable HTTPS/HTTP protocols
- Uses official ali-oss SDK

## API Reference

### Main Functions

- `uploadFile(file, filename, contentType, folder?)`: Upload a file to storage
- `deleteFile(key)`: Delete a file from storage
- `getPresignedUploadUrl(filename, contentType, folder?, expiresIn?)`: Generate a pre-signed URL
- `uploadFileFromBrowser(file, folder?)`: Upload a file from the browser

### Provider Interface

The `StorageProvider` interface defines the following methods:

- `uploadFile(params)`: Upload a file to storage
- `deleteFile(key)`: Delete a file from storage
- `getPresignedUploadUrl(params)`: Generate a pre-signed URL
- `getProviderName()`: Get the provider name

### Configuration

The `StorageConfig` interface defines the configuration options:

- `region`: Storage region (e.g., 'us-east-1' for S3, 'cn-hangzhou' for OSS)
- `endpoint?`: Custom endpoint URL for S3-compatible services or OSS
- `accessKeyId`: Access key ID for authentication
- `secretAccessKey`: Secret access key for authentication
- `bucketName`: Storage bucket name
- `publicUrl?`: Public URL for accessing files
- `forcePathStyle?`: Whether to use path-style URLs (S3 only)
- `ossInternal?`: Whether to use internal endpoint for OSS (OSS only)
- `ossSecure?`: Whether to use HTTPS for OSS (OSS only) 