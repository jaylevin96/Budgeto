type FormMessageProps = {
  children: React.ReactNode;
};

export function FormError({ children }: FormMessageProps) {
  if (!children) return null;
  return (
    <p className="text-sm text-[var(--color-destructive)]" role="alert">
      {children}
    </p>
  );
}

export function FormSuccess({ children }: FormMessageProps) {
  if (!children) return null;
  return (
    <p className="text-sm text-[var(--color-success)]" role="status">
      {children}
    </p>
  );
}
