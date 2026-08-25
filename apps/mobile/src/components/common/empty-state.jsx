import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function EmptyState({ title, description }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
    </Card>
  );
}
