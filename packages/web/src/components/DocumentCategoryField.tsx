import { CatalogueCombo } from './CatalogueCombo';
import { useDocumentCategories } from '../lib/documentCategories';

/**
 * The category box on every form that files a document. Type to find one of
 * the account's categories; a name that is not there yet becomes a new
 * category when the document is saved.
 */
export function DocumentCategoryField({
  profileId,
  value,
  onChange,
  id,
}: {
  profileId: string;
  value: string;
  onChange: (name: string) => void;
  id: string;
}) {
  const { data } = useDocumentCategories(profileId);
  const names = (data?.categories ?? []).map((c) => c.name);
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-ink mb-1">Category</label>
      <CatalogueCombo
        id={id}
        ariaLabel="Category"
        placeholder="Type to find or add one"
        extraItems={names}
        keepValue
        initial={value}
        onPick={onChange}
        widthClass="w-full"
        newLabel={(name) => `+ Add "${name}" as a category`}
      />
    </div>
  );
}
