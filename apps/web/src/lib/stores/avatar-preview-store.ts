import { create } from 'zustand'

interface AvatarPreviewState {
  isOpen: boolean
  imageUrl: string
  userName: string
  openPreview: (imageUrl: string, userName: string) => void
  closePreview: () => void
}

export const useAvatarPreviewStore = create<AvatarPreviewState>((set) => ({
  isOpen: false,
  imageUrl: '',
  userName: '',
  openPreview: (imageUrl: string, userName: string) => set({ isOpen: true, imageUrl, userName }),
  closePreview: () => set({ isOpen: false, imageUrl: '', userName: '' }),
}))
