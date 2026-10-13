import { useState } from "react";
import { Link } from "react-router-dom";
import { FileSpreadsheet, ListPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FormError } from "@/components/ui/form-message";
import { seedDefaults } from "@/lib/importer";

/** Shown when the user has no categories yet. */
export function EmptyBudget({ onSeeded }: { onSeeded: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSeed() {
    setBusy(true);
    setError(null);
    try {
      await seedDefaults();
      onSeeded();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create categories");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mx-auto max-w-lg">
      <CardHeader>
        <CardTitle className="text-xl">Set up your budget</CardTitle>
        <CardDescription>
          Import your existing spreadsheet to bring in categories, line items and every month you've already
          entered. Or start from the same categories with no amounts.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 sm:flex-row">
        <Button asChild className="flex-1">
          <Link to="/settings/import">
            <FileSpreadsheet /> Import spreadsheet
          </Link>
        </Button>
        <Button variant="outline" className="flex-1" onClick={handleSeed} disabled={busy}>
          <ListPlus /> {busy ? "Creating…" : "Start with defaults"}
        </Button>
      </CardContent>
      {error && (
        <CardContent>
          <FormError>{error}</FormError>
        </CardContent>
      )}
    </Card>
  );
}
