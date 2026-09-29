import { Heading, Hr, Section, Text } from '@react-email/components'
import EmailLayout from '../components/email-layout'
import type { BaseEmailProps } from '../types'

interface WechatWebhookFailedProps extends BaseEmailProps {
  orderId?: string
  errorMessage: string
  errorType: 'parse_error' | 'validation_error' | 'processing_error' | 'unknown_error'
  webhookData?: Record<string, any>
  timestamp: string
  stackTrace?: string
}

export function WechatWebhookFailed({
  orderId,
  errorMessage,
  errorType,
  webhookData,
  timestamp,
  stackTrace,
  locale,
  messages,
}: WechatWebhookFailedProps) {
  const getErrorTypeLabel = () => {
    switch (errorType) {
      case 'parse_error':
        return 'XML 解析错误'
      case 'validation_error':
        return '数据验证错误'
      case 'processing_error':
        return '业务处理错误'
      case 'unknown_error':
        return '未知错误'
      default:
        return '错误'
    }
  }

  return (
    <EmailLayout locale={locale} messages={messages}>
      <Heading className='font-bold text-2xl text-red-600'>⚠️ 微信支付 Webhook 处理失败通知</Heading>

      <Text className='mt-4'>微信支付 Webhook 回调处理时发生错误，详情如下：</Text>

      <Section className='mt-6 rounded-lg border-red-500 border-l-4 bg-gray-50 p-4'>
        <Heading as='h3' className='font-semibold text-lg'>
          错误信息
        </Heading>
        <Text className='mt-2'>
          <strong>错误类型：</strong>
          {getErrorTypeLabel()}
        </Text>
        {orderId && (
          <Text>
            <strong>订单ID：</strong>
            {orderId}
          </Text>
        )}
        <Text>
          <strong>发生时间：</strong>
          {timestamp}
        </Text>
      </Section>

      <Section className='mt-4 rounded-lg bg-red-50 p-4'>
        <Heading as='h3' className='font-semibold text-lg text-red-700'>
          错误详情
        </Heading>
        <pre className='mt-2 whitespace-pre-wrap break-words font-mono text-gray-800 text-sm'>{errorMessage}</pre>
      </Section>

      {webhookData && Object.keys(webhookData).length > 0 && (
        <Section className='mt-4 rounded-lg border-blue-500 border-l-4 bg-gray-50 p-4'>
          <Heading as='h3' className='font-semibold text-lg'>
            Webhook 数据
          </Heading>
          <pre className='mt-2 whitespace-pre-wrap break-words font-mono text-gray-800 text-xs'>
            {JSON.stringify(webhookData, null, 2)}
          </pre>
        </Section>
      )}

      {stackTrace && (
        <Section className='mt-4 rounded-lg bg-yellow-50 p-4'>
          <Heading as='h3' className='font-semibold text-lg text-yellow-700'>
            堆栈跟踪
          </Heading>
          <pre className='mt-2 whitespace-pre-wrap break-words font-mono text-gray-800 text-xs'>{stackTrace}</pre>
        </Section>
      )}

      <Hr className='my-6' />

      <Section className='rounded-lg bg-blue-50 p-4'>
        <Text className='font-semibold text-gray-700 text-sm'>建议操作：</Text>
        <Text className='mt-2 text-gray-700 text-sm'>1. 检查服务器日志获取更多详情</Text>
        <Text className='text-gray-700 text-sm'>2. 验证微信支付配置是否正确</Text>
        <Text className='text-gray-700 text-sm'>3. 检查数据库连接是否正常</Text>
        <Text className='text-gray-700 text-sm'>4. 验证订单是否存在</Text>
        {errorType === 'parse_error' && <Text className='mt-2 text-gray-700 text-sm'>5. 检查 XML 格式是否正确</Text>}
        {errorType === 'validation_error' && (
          <Text className='mt-2 text-gray-700 text-sm'>5. 检查必要字段是否完整</Text>
        )}
        {errorType === 'processing_error' && (
          <Text className='mt-2 text-gray-700 text-sm'>5. 检查业务逻辑处理是否正常</Text>
        )}
      </Section>

      <Section className='mt-4 rounded-lg bg-yellow-50 p-4'>
        <Text className='text-gray-700 text-sm'>
          <strong>说明：</strong>
          <br />
          即使处理失败，系统也会返回成功响应给微信支付，避免重复通知。
          <br />
          请及时处理此错误，确保充值流程正常运行。
        </Text>
      </Section>

      <Text className='mt-4 text-gray-500 text-xs'>此邮件由微信支付 Webhook 系统自动发送</Text>
      <Text className='text-gray-500 text-xs'>时间: {timestamp}</Text>
    </EmailLayout>
  )
}

export default WechatWebhookFailed
