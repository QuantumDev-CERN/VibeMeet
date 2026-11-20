interface EmptyStateProps {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}

export default function EmptyState({ title, children, action }: EmptyStateProps) {
  return (
    <div className="empty">
      <h3 className="empty__title">{title}</h3>
      <div className="empty__body">{children}</div>
      {action}
    </div>
  );
}
