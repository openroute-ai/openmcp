'use client'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@workspace/ui/components/tabs'
import A2aAgentsPage from '../a2a-agents/page'
import McpServersPage from '../mcp-servers/page'
import ProviderApplicationsPage from '../providers/page'

/**
 * User submissions.
 *
 * This is a view, not a new data source: it aggregates the three queues that
 * accept user-submitted content (provider applications, A2A agents and MCP
 * servers) behind tabs. Each tab embeds the existing page component, so there
 * is exactly one implementation of each review flow and the standalone routes
 * stay in sync for free.
 *
 * Each embedded page renders its own heading, which is why the tab labels, not
 * a shared title, carry the meaning here.
 */
export default function UserSubmissionsPage() {
  return (
    <div className='space-y-6'>
      <div>
        <h1 className='font-bold text-2xl tracking-tight'>用户提交</h1>
        <p className='text-muted-foreground'>集中处理用户提交的待审核内容：入驻申请、A2A 智能体和 MCP Server</p>
      </div>

      <Tabs defaultValue='providers'>
        <TabsList>
          <TabsTrigger value='providers'>入驻申请</TabsTrigger>
          <TabsTrigger value='a2a'>A2A 智能体</TabsTrigger>
          <TabsTrigger value='mcp'>MCP Server</TabsTrigger>
        </TabsList>

        {/* `forceMount` keeps each tab's page mounted (hidden) instead of
            unmounting it, so switching tabs does not re-run its queries or
            discard the operator's search, filters and page number. Without it
            each switch resets all three tables to page 1. */}
        <TabsContent value='providers' className='pt-4' forceMount>
          <ProviderApplicationsPage />
        </TabsContent>
        <TabsContent value='a2a' className='pt-4' forceMount>
          <A2aAgentsPage />
        </TabsContent>
        <TabsContent value='mcp' className='pt-4' forceMount>
          <McpServersPage />
        </TabsContent>
      </Tabs>
    </div>
  )
}
