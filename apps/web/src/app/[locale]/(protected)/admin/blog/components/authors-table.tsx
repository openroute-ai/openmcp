'use client'

import { Edit, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '@workspace/ui/components/badge'
import { Button } from '@workspace/ui/components/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@workspace/ui/components/table'
import { EditAuthorDialog } from './edit-author-dialog'

interface Author {
  id: string
  name: string
  slug: string
  avatar: string
  locale: string
}

interface AuthorsTableProps {
  data: Author[]
  onDelete: (author: { id: string; name: string }) => void
  onRefresh: () => void
}

export function AuthorsTable({ data, onDelete, onRefresh }: AuthorsTableProps) {
  const [editingAuthorId, setEditingAuthorId] = useState<string | null>(null)
  return (
    <div className='space-y-4'>
      <div className='rounded-md border'>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>名称</TableHead>
              <TableHead>Slug</TableHead>
              <TableHead>语言</TableHead>
              <TableHead>头像</TableHead>
              <TableHead className='text-right'>操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className='text-center'>
                  暂无数据
                </TableCell>
              </TableRow>
            ) : (
              data.map((author) => (
                <TableRow key={author.id}>
                  <TableCell className='font-medium'>{author.name}</TableCell>
                  <TableCell>{author.slug}</TableCell>
                  <TableCell>
                    <Badge variant='outline'>{author.locale}</Badge>
                  </TableCell>
                  <TableCell>
                    {author.avatar ? (
                      <img src={author.avatar} alt={author.name} className='h-8 w-8 rounded-full' />
                    ) : (
                      '-'
                    )}
                  </TableCell>
                  <TableCell className='text-right'>
                    <div className='flex items-center justify-end gap-2'>
                      <Button variant='ghost' size='icon' onClick={() => setEditingAuthorId(author.id)}>
                        <Edit className='h-4 w-4' />
                      </Button>
                      <Button
                        variant='ghost'
                        size='icon'
                        onClick={() => onDelete({ id: author.id, name: author.name })}
                      >
                        <Trash2 className='h-4 w-4 text-destructive' />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      <EditAuthorDialog
        open={editingAuthorId !== null}
        onOpenChange={(open) => !open && setEditingAuthorId(null)}
        onSuccess={() => {
          onRefresh()
          setEditingAuthorId(null)
        }}
        authorId={editingAuthorId}
      />
    </div>
  )
}
