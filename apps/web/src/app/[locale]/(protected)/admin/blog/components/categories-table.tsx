'use client'

import { Edit, RefreshCw, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '@workspace/ui/components/badge'
import { Button } from '@workspace/ui/components/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@workspace/ui/components/table'
import { EditCategoryDialog } from './edit-category-dialog'

interface Category {
  id: string
  name: string
  slug: string
  description: string
  locale: string
}

interface CategoriesTableProps {
  data: Category[]
  onDelete: (category: { id: string; name: string }) => void
  onRefresh: () => void
}

export function CategoriesTable({ data, onDelete, onRefresh }: CategoriesTableProps) {
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null)
  return (
    <div className='space-y-4'>
      <div className='flex items-center justify-end'>
        <Button variant='outline' size='icon' onClick={onRefresh}>
          <RefreshCw className='h-4 w-4' />
        </Button>
      </div>

      <div className='rounded-md border'>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>名称</TableHead>
              <TableHead>Slug</TableHead>
              <TableHead>描述</TableHead>
              <TableHead>语言</TableHead>
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
              data.map((category) => (
                <TableRow key={category.id}>
                  <TableCell className='font-medium'>{category.name}</TableCell>
                  <TableCell>{category.slug}</TableCell>
                  <TableCell>{category.description}</TableCell>
                  <TableCell>
                    <Badge variant='outline'>{category.locale}</Badge>
                  </TableCell>
                  <TableCell className='text-right'>
                    <div className='flex items-center justify-end gap-2'>
                      <Button variant='ghost' size='icon' onClick={() => setEditingCategoryId(category.id)}>
                        <Edit className='h-4 w-4' />
                      </Button>
                      <Button
                        variant='ghost'
                        size='icon'
                        onClick={() => onDelete({ id: category.id, name: category.name })}
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
      <EditCategoryDialog
        open={editingCategoryId !== null}
        onOpenChange={(open) => !open && setEditingCategoryId(null)}
        onSuccess={() => {
          onRefresh()
          setEditingCategoryId(null)
        }}
        categoryId={editingCategoryId}
      />
    </div>
  )
}
