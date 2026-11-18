import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';

/**
 * Document categories belong to the account and are shared by everyone it
 * cares for. Anyone who can file a document can add one by typing a new
 * name; only the account owner can rename, combine or delete them.
 */
export interface DocumentCategory {
  id: string;
  name: string;
  system_key: string | null;
  /** Always kept: it can be renamed but never deleted. */
  kept: boolean;
  kept_reason: string | null;
  /** Present for the account owner only. */
  document_count?: number;
}

export interface DocumentCategoryList {
  can_manage: boolean;
  categories: DocumentCategory[];
}

export const documentCategoriesKey = (profileId: string) => ['document-categories', profileId];

export function useDocumentCategories(profileId: string) {
  return useQuery({
    queryKey: documentCategoriesKey(profileId),
    queryFn: () => api.get<DocumentCategoryList>(`/care-profiles/${profileId}/document-categories`),
  });
}

/** What a document's category is called, falling back to Other. */
export const categoryNameOf = (d: { category_name: string | null }): string => d.category_name || 'Other';
