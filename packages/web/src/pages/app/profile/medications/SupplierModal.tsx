import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api } from '../../../../api/client';
import { Button } from '../../../../components/ui/Button';
import { Input } from '../../../../components/ui/Input';
import { Modal } from '../../../../components/ui/Modal';
import { AddressFields, addressPayload, emptyAddress, type AddressValue } from '../../../../components/AddressFields';
import type { Supplier } from '../../../../lib/care';

/**
 * Create a supplier from within the medication editor, with the same fields
 * and the same type-ahead address finder as the supplier directory. The
 * address suburb tells apart two branches of one vendor; the reorder link,
 * phone and address live on the supplier, reused by every medication that
 * names it.
 */
export function SupplierModal({ onClose, onCreated }: { onClose: () => void; onCreated: (s: Supplier) => void }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState<AddressValue>(emptyAddress);
  const [orderUrl, setOrderUrl] = useState('');
  const [directionsLink, setDirectionsLink] = useState('');
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: () => api.post<{ supplier: Supplier }>('/suppliers', {
      name: name.trim(),
      phone: phone.trim() || null,
      email: email.trim() || null,
      ...addressPayload(address),
      order_url: orderUrl.trim() || null,
      directions_link: directionsLink.trim() || null,
    }),
    onSuccess: (res) => onCreated(res.supplier),
    onError: (err) => setError(err instanceof Error ? err.message : 'Failed to save'),
  });

  return (
    <Modal open onClose={onClose} title="Add a supplier" wide>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (name.trim()) mutation.mutate(); }}>
        <Input label="Vendor name" value={name} onChange={(e) => setName(e.target.value)} required placeholder="e.g. Chemist Warehouse" />
        <div className="grid grid-cols-2 gap-2">
          <Input label="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="e.g. 07 5555 5555" />
          <Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <AddressFields value={address} onChange={setAddress} />
        <div className="grid grid-cols-2 gap-2">
          <Input label="Reorder link" type="url" inputMode="url" value={orderUrl} onChange={(e) => setOrderUrl(e.target.value)} placeholder="https://…" hint="Where the Order button goes to restock." />
          <Input label="Directions" type="url" inputMode="url" value={directionsLink} onChange={(e) => setDirectionsLink(e.target.value)} placeholder="https://…" hint="A map link to the shop." />
        </div>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={mutation.isPending} disabled={!name.trim()}>Add supplier</Button>
        </div>
      </form>
    </Modal>
  );
}
