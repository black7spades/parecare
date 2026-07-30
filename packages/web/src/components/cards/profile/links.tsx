/** A phone number and an email address, tappable wherever they appear. */
export function PhoneLink({ phone }: { phone: string }) {
  return (
    <a href={`tel:${phone.replace(/[^\d+]/g, '')}`} className="text-primary hover:underline">
      {phone}
    </a>
  );
}

/** An email address as a mailto link. */
export function EmailLink({ email }: { email: string }) {
  return (
    <a href={`mailto:${email}`} className="text-primary hover:underline">
      {email}
    </a>
  );
}

/** One line describing where the person lives, from a facility or a private address. */
