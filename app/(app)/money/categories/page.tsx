import type { Metadata } from 'next';
import Link from 'next/link';

import { PageHeader } from '../../../_components/page-shell';
import { categoryTree, listCategories } from '@/server/services';
import { Disclosure, InlineAction } from '../_components';
import { CategoryForm } from '../_forms';
import { createCategoryAction, deleteCategoryAction } from '../actions';
import { loadMoneyContext } from '../_page-data';

export const metadata: Metadata = { title: 'Categories' };

/**
 * Categories, two levels deep.
 *
 * The parents matter, not only the leaves: "how much did I spend on food?" needs
 * a `Food` parent for `Groceries` and `Dining` to roll up into. A category in
 * use cannot be deleted — it is archived, which hides it from pickers and keeps
 * it in historical reports.
 */
export default async function CategoriesPage() {
  const { ctx } = await loadMoneyContext('/money/categories');
  const [tree, flat] = await Promise.all([
    categoryTree(ctx, { includeArchived: true }),
    listCategories(ctx, { includeArchived: true, withCounts: true }),
  ]);

  const counts = new Map(flat.map((c) => [c.id, c.transactionCount]));
  const parents = flat.filter((c) => c.parentId === null);

  return (
    <>
      <PageHeader
        title="Categories"
        description="One per transaction, two levels maximum. A child shares its parent's kind."
        actions={
          <Link href="/money" className="text-sm text-ink-muted hover:text-ink">
            ← Money
          </Link>
        }
      />

      <Disclosure summary="Add a category">
        <CategoryForm
          action={createCategoryAction}
          parents={parents.map((p) => ({ id: p.id, label: p.name, kind: p.kind }))}
        />
      </Disclosure>

      {(['expense', 'income'] as const).map((kind) => {
        const roots = tree.filter((node) => node.kind === kind);
        if (roots.length === 0) return null;

        return (
          <section key={kind} className="space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-faint">{kind}</h2>
            <ul className="divide-y divide-border rounded-lg border border-border">
              {roots.map((root) => (
                <li key={root.id} className="px-3 py-2">
                  <Row
                    id={root.id}
                    name={root.name}
                    archived={root.isArchived}
                    count={counts.get(root.id) ?? 0}
                    childCount={root.children.length}
                  />
                  {root.children.length > 0 ? (
                    <ul className="mt-1 space-y-1 border-l border-border pl-4">
                      {root.children.map((child) => (
                        <li key={child.id}>
                          <Row
                            id={child.id}
                            name={child.name}
                            archived={child.isArchived}
                            count={counts.get(child.id) ?? 0}
                            childCount={0}
                          />
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </>
  );
}

function Row({
  id,
  name,
  archived,
  count,
  childCount,
}: {
  id: string;
  name: string;
  archived: boolean;
  count: number;
  childCount: number;
}) {
  const deletable = count === 0 && childCount === 0;

  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className={archived ? 'text-ink-faint line-through' : ''}>{name}</span>
      <span className="flex items-center gap-3">
        <span className="text-xs text-ink-faint">
          {count === 0 ? 'unused' : `${count} transaction${count === 1 ? '' : 's'}`}
        </span>
        {deletable ? (
          <InlineAction
            action={deleteCategoryAction}
            label="Delete"
            variant="danger"
            values={{ id }}
            confirm={`Delete ${name}? Nothing uses it.`}
          />
        ) : (
          <span className="text-xs text-ink-faint" title="A category in use cannot be deleted">
            in use
          </span>
        )}
      </span>
    </div>
  );
}
