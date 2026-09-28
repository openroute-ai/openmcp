import { Heading, Hr, Section, Text } from '@react-email/components'
import EmailLayout from '../components/email-layout'
import type { BaseEmailProps } from '../types'

interface LiteLLMBudgetUpdateFailedProps extends BaseEmailProps {
  orderId: string
  amount: number
  newBalance: number
  userId: string
  userName: string
  userEmail: string
  errorMessage: string
  timestamp: string
}

export function LiteLLMBudgetUpdateFailed({
  orderId,
  amount,
  newBalance,
  userId,
  userName,
  userEmail,
  errorMessage,
  timestamp,
  locale,
  messages,
}: LiteLLMBudgetUpdateFailedProps) {
  return (
    <EmailLayout locale={locale} messages={messages}>
      <Heading className='font-bold text-2xl text-red-600'>⚠️ LiteLLM 账户余额更新失败通知</Heading>

      <Text className='mt-4'>充值成功后，更新 LiteLLM 用户预算时发生错误，详情如下：</Text>

      <Section className='mt-6 rounded-lg border-red-500 border-l-4 bg-gray-50 p-4'>
        <Heading as='h3' className='font-semibold text-lg'>
          订单信息
        </Heading>
        <Text className='mt-2'>
          <strong>订单ID：</strong>
          {orderId}
        </Text>
        <Text>
          <strong>充值金额：</strong>¥{amount.toFixed(2)}
        </Text>
        <Text>
          <strong>新余额：</strong>¥{newBalance.toFixed(2)}
        </Text>
        <Text>
          <strong>更新时间：</strong>
          {timestamp}
        </Text>
      </Section>

      <Section className='mt-4 rounded-lg border-blue-500 border-l-4 bg-gray-50 p-4'>
        <Heading as='h3' className='font-semibold text-lg'>
          用户信息
        </Heading>
        <Text className='mt-2'>
          <strong>用户ID：</strong>
          {userId}
        </Text>
        <Text>
          <strong>用户名：</strong>
          {userName}
        </Text>
        <Text>
          <strong>用户邮箱：</strong>
          {userEmail}
        </Text>
      </Section>

      <Section className='mt-4 rounded-lg bg-red-50 p-4'>
        <Heading as='h3' className='font-semibold text-lg text-red-700'>
          错误详情
        </Heading>
        <pre className='mt-2 whitespace-pre-wrap break-words font-mono text-gray-800 text-sm'>{errorMessage}</pre>
      </Section>

      <Hr className='my-6' />

      <Section className='rounded-lg bg-yellow-50 p-4'>
        <Text className='text-gray-700 text-sm'>
          <strong>说明：</strong>
          <br />
          数据库余额已成功更新，但 LiteLLM 中的用户预算更新失败。
          <br />
          请手动检查并更新 LiteLLM 中用户 <strong>{userId}</strong> 的 max_budget 为 <strong>{newBalance}</strong>。
        </Text>
      </Section>

      <Section className='mt-4 rounded-lg bg-blue-50 p-4'>
        <Text className='font-semibold text-gray-700 text-sm'>建议操作：</Text>
        <Text className='mt-2 text-gray-700 text-sm'>1. 检查 LiteLLM API 服务是否正常</Text>
        <Text className='text-gray-700 text-sm'>2. 检查网络连接是否稳定</Text>
        <Text className='text-gray-700 text-sm'>3. 手动更新 LiteLLM 用户预算</Text>
        <Text className='mt-2 text-gray-700 text-sm'>
          手动更新命令：
          <br />
          <code className='mt-1 block whitespace-pre-wrap break-words rounded bg-gray-100 p-2 font-mono text-xs'>
            {`curl --location 'http://localhost:4000/user/new' \\
--header 'Authorization: Bearer <your-master-key>' \\
--header 'Content-Type: application/json' \\
--data-raw '{"user_id": "${userId}", "max_budget": ${newBalance}}'`}
          </code>
        </Text>
        <Text className='text-gray-700 text-sm'>4. 查看服务器日志获取更多详情</Text>
      </Section>
    </EmailLayout>
  )
}

export default LiteLLMBudgetUpdateFailed
