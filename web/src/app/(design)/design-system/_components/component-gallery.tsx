"use client";

import { AlertTriangle, CheckCircle2, Info } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/**
 * Un échantillon représentatif, pas les soixante composants installés.
 *
 * Le critère de sélection est la couverture des tokens : cet ensemble exerce
 * chaque surface, chaque état, la frontière de champ, l'anneau de focus et les
 * quatre niveaux d'élévation. Rendre les soixante ajouterait un millier de
 * lignes sans exercer un seul token de plus, et la page deviendrait trop longue
 * pour servir de recette avant une PR — ce à quoi elle est destinée.
 */
export function ComponentGallery() {
  return (
    <div className="space-y-10">
      <section aria-labelledby="gallery-buttons">
        <h3 id="gallery-buttons" className="mb-3 text-sm font-semibold text-muted-foreground">
          Boutons
        </h3>
        <div className="flex flex-wrap items-center gap-3">
          <Button>Action principale</Button>
          <Button variant="secondary">Secondaire</Button>
          <Button variant="outline">Contour</Button>
          <Button variant="ghost">Discret</Button>
          <Button variant="destructive">Supprimer</Button>
          <Button variant="link">Lien</Button>
          <Button disabled>Désactivé</Button>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button size="xs">xs · 24px</Button>
          <Button size="sm">sm · 32px</Button>
          <Button size="default">default · 36px</Button>
          <Button size="lg">lg · 40px</Button>
        </div>
      </section>

      <section aria-labelledby="gallery-fields">
        <h3 id="gallery-fields" className="mb-3 text-sm font-semibold text-muted-foreground">
          Champs et sélection
        </h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="demo-email">Adresse électronique</Label>
            <Input id="demo-email" type="email" placeholder="ana@exemple.fr" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="demo-invalid">Champ en erreur</Label>
            <Input
              id="demo-invalid"
              aria-invalid="true"
              aria-describedby="demo-invalid-error"
              defaultValue="valeur refusée"
            />
            <p id="demo-invalid-error" className="text-xs text-destructive">
              Cette adresse est déjà utilisée.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="demo-disabled">Champ désactivé</Label>
            <Input id="demo-disabled" disabled defaultValue="lecture seule" />
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-6">
          <div className="flex items-center gap-2">
            <Checkbox id="demo-check" defaultChecked />
            <Label htmlFor="demo-check">Cases à cocher</Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="demo-switch" defaultChecked />
            <Label htmlFor="demo-switch">Interrupteur</Label>
          </div>
        </div>
      </section>

      <section aria-labelledby="gallery-states">
        <h3 id="gallery-states" className="mb-3 text-sm font-semibold text-muted-foreground">
          États et pastilles
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          <Badge>Actif</Badge>
          <Badge variant="secondary">Brouillon</Badge>
          <Badge variant="outline">Archivé</Badge>
          <Badge variant="destructive">Suspendu</Badge>
          {/*
            L'ambre n'est jamais un fond plein à libellé clair : la palette
            source donnait 2.15:1 avec du blanc. Texte foncé imposé.
          */}
          <span className="inline-flex items-center rounded-full bg-warning px-2.5 py-0.5 text-xs font-medium text-warning-foreground">
            En attente
          </span>
          <span className="inline-flex items-center rounded-full bg-success px-2.5 py-0.5 text-xs font-medium text-success-foreground">
            Confirmé
          </span>
        </div>

        <div className="mt-4 space-y-3">
          <Alert>
            <Info aria-hidden="true" />
            <AlertTitle>Rotation de session</AlertTitle>
            <AlertDescription>
              Changer d&apos;organisation régénère la session et purge le cache client.
            </AlertDescription>
          </Alert>
          <Alert variant="destructive">
            <AlertTriangle aria-hidden="true" />
            <AlertTitle>Accès refusé</AlertTitle>
            <AlertDescription>
              Cette organisation ne correspond pas à votre session active.
            </AlertDescription>
          </Alert>
        </div>
      </section>

      <section aria-labelledby="gallery-surfaces">
        <h3 id="gallery-surfaces" className="mb-3 text-sm font-semibold text-muted-foreground">
          Surfaces et élévation
        </h3>
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Organisation</CardTitle>
              <CardDescription>
                Carte au repos — élévation 1, bordure décorative.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex items-center gap-3">
              <Avatar>
                <AvatarFallback>AD</AvatarFallback>
              </Avatar>
              <div className="text-sm">
                <p className="font-medium">Ana Diallo</p>
                <p className="text-muted-foreground">Administratrice client</p>
              </div>
            </CardContent>
            <CardFooter className="gap-2">
              <Button size="sm">Ouvrir</Button>
              <Button size="sm" variant="ghost">
                Détails
              </Button>
            </CardFooter>
          </Card>

          <div className="grid gap-3">
            {(["shadow-sm", "shadow-md", "shadow-lg", "shadow-xl"] as const).map(
              (level, index) => (
                <div
                  key={level}
                  className={`rounded-lg border border-border bg-card p-3 text-sm ${level}`}
                >
                  <span className="font-mono text-xs">{level}</span>
                  <span className="ml-2 text-muted-foreground">
                    élévation {index + 1}
                  </span>
                </div>
              ),
            )}
          </div>
        </div>
      </section>

      <section aria-labelledby="gallery-navigation">
        <h3 id="gallery-navigation" className="mb-3 text-sm font-semibold text-muted-foreground">
          Navigation et chargement
        </h3>
        <Tabs defaultValue="membres">
          <TabsList>
            <TabsTrigger value="membres">Membres</TabsTrigger>
            <TabsTrigger value="roles">Rôles</TabsTrigger>
            <TabsTrigger value="sessions">Sessions</TabsTrigger>
          </TabsList>
          <TabsContent value="membres" className="pt-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm">
                <CheckCircle2 className="size-4 text-success" aria-hidden="true" />
                Quatre membres actifs
              </div>
              <div className="space-y-2 pt-2">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-4 w-3/5" />
              </div>
            </div>
          </TabsContent>
          <TabsContent value="roles" className="pt-4 text-sm text-muted-foreground">
            Les rôles sont résolus côté serveur, jamais portés par le jeton.
          </TabsContent>
          <TabsContent value="sessions" className="pt-4 text-sm text-muted-foreground">
            Une session par organisation active. La bascule en crée une nouvelle.
          </TabsContent>
        </Tabs>
      </section>
    </div>
  );
}
