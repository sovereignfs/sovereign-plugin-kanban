'use client';

import { useActionState, useEffect, useState, useTransition } from 'react';
import type { DirectoryUser } from '@sovereignfs/sdk';
import {
  Avatar,
  Button,
  ConfirmDialog,
  Dialog,
  FormField,
  Input,
  SegmentedControl,
  Textarea,
  Typography,
  useToast,
} from '@sovereignfs/ui';
import {
  addProjectMember,
  deleteProject,
  removeProjectMember,
  searchProjectMemberCandidates,
  updateProjectForm,
  updateProjectMemberRole,
} from '../actions';
import { displayName } from '../_lib/identity';
import type { HomeProject } from '../_lib/queries';
import type { CurrentUser } from './BoardView';
import styles from '../kanban.module.css';

const SEARCH_DEBOUNCE_MS = 250;
const MIN_QUERY_LENGTH = 2;

/**
 * Home listing's single per-project CTA (settings gear, right after the
 * name) — replaces the three separate Edit/Delete/Share dialogs a previous
 * round of this feature had. One surface: name/description/visibility,
 * members, and delete (a "Danger zone" section, not its own icon) —
 * because these were three different entry points into overlapping and
 * increasingly inconsistent state as project ownership grew co-owner-aware
 * (K.18/K.19). Every project member can open this to view it; the edit
 * form, member management, and danger zone only render for an owner
 * ("owner-only management, not owner-only visibility" — same K.9
 * precedent `BoardShareDialog` already established for boards).
 *
 * Reads `project` straight from props on every render, never a local copy
 * — every mutation here calls `refresh()`, and the parent must pass a
 * live-derived `project` (by id, from its own `projects` prop) rather than
 * a captured snapshot. Storing the snapshot in `useState` reproduced K.8's
 * `CardActivity` staleness bug once already in this feature's first
 * version (see SPEC.md's K.19 entry) — don't repeat it at the call site.
 */
export function ManageProjectDialog({
  project,
  currentUser,
  onClose,
}: {
  project: HomeProject;
  currentUser: CurrentUser;
  onClose: () => void;
}) {
  const toast = useToast();
  const isOwner = project.role === 'owner';

  function onMemberError(message: string): void {
    toast.show({ title: 'Couldn’t update members', message, category: 'error' });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      size="md"
      title={isOwner ? 'Manage project' : 'Project members'}
      aria-label={isOwner ? `Manage ${project.name}` : `${project.name} members`}
    >
      <div className={styles.dialogBody}>
        <Typography variant="h3" className={styles.dialogStickyHeader}>
          {isOwner ? 'Manage project' : 'Project members'}
        </Typography>
        {isOwner ? (
          <ProjectDetailsForm project={project} />
        ) : (
          <ProjectDetailsReadOnly project={project} />
        )}

        <div className={styles.manageSection}>
          <div className={styles.manageSectionHeader}>
            <Typography variant="label">Members</Typography>
            <Typography variant="caption">{project.members.length}</Typography>
          </div>
          <ul className={styles.memberList}>
            {project.members.map((member) => (
              <MemberRow
                key={member.userId}
                projectId={project.id}
                member={member}
                currentUser={currentUser}
                canManage={isOwner}
                onError={onMemberError}
              />
            ))}
          </ul>
          {isOwner && <MemberPicker projectId={project.id} onError={onMemberError} />}
        </div>

        {isOwner && <DangerZone project={project} onDeleted={onClose} />}
      </div>
    </Dialog>
  );
}

function ProjectDetailsForm({ project }: { project: HomeProject }) {
  const toast = useToast();
  const [state, formAction, pending] = useActionState(updateProjectForm, null);
  const [visibility, setVisibility] = useState<'public' | 'private'>(
    project.visibility === 'private' ? 'private' : 'public',
  );

  useEffect(() => {
    if (state?.ok) toast.show({ title: 'Project updated', category: 'success' });
  }, [state, toast]);

  return (
    <form action={formAction} className={styles.manageSection}>
      <input type="hidden" name="projectId" value={project.id} />
      <input type="hidden" name="visibility" value={visibility} />
      <FormField label="Name" required>
        {(field) => <Input {...field} name="name" defaultValue={project.name} disabled={pending} />}
      </FormField>
      <FormField label="Description" hint="Optional">
        {(field) => (
          <Textarea
            {...field}
            name="description"
            rows={2}
            defaultValue={project.description ?? ''}
            disabled={pending}
          />
        )}
      </FormField>
      <FormField
        label="Visibility"
        className={styles.visibilityField}
        hint={
          visibility === 'public'
            ? 'Project members can view every public board without being added to it.'
            : 'Only board members and project owners can see any board in this project.'
        }
      >
        {() => (
          <SegmentedControl
            aria-label="Project visibility"
            value={visibility}
            onChange={(value) => setVisibility(value === 'private' ? 'private' : 'public')}
            options={[
              { label: 'Public', value: 'public' },
              { label: 'Private', value: 'private' },
            ]}
          />
        )}
      </FormField>
      {state && !state.ok && <p className={styles.formError}>{state.error}</p>}
      <Button
        type="submit"
        variant="secondary"
        loading={pending}
        className={styles.saveProjectButton}
      >
        {pending ? 'Saving…' : 'Save changes'}
      </Button>
    </form>
  );
}

function ProjectDetailsReadOnly({ project }: { project: HomeProject }) {
  return (
    <div className={styles.manageSection}>
      <Typography variant="h3">{project.name}</Typography>
      {project.description && <Typography variant="body">{project.description}</Typography>}
      <Typography variant="caption">
        {project.visibility === 'private'
          ? 'Private — only board members and project owners can see any board in this project.'
          : 'Public — project members can view every public board without being added to it.'}
      </Typography>
    </div>
  );
}

function MemberRow({
  projectId,
  member,
  currentUser,
  canManage,
  onError,
}: {
  projectId: string;
  member: HomeProject['members'][number];
  currentUser: CurrentUser;
  canManage: boolean;
  onError: (message: string) => void;
}) {
  const [pending, startTransition] = useTransition();
  // A one-member lookup array — `member` already carries name/email, so
  // `displayName` resolves it without needing the full member list.
  const name = displayName(member.userId, currentUser, [member]);
  const showEmail = Boolean(member.email) && member.email !== name;
  const isOwnerRow = member.role === 'owner';

  function toggleRole(): void {
    startTransition(async () => {
      const result = await updateProjectMemberRole({
        projectId,
        userId: member.userId,
        role: isOwnerRow ? 'member' : 'owner',
      });
      if (!result.ok) onError(result.error);
    });
  }

  function remove(): void {
    startTransition(async () => {
      const result = await removeProjectMember({ projectId, userId: member.userId });
      if (!result.ok) onError(result.error);
    });
  }

  return (
    <li className={styles.memberRow}>
      <Avatar name={name} src={member.image ?? undefined} size="sm" />
      <div className={styles.memberInfo}>
        <Typography variant="body">{name}</Typography>
        {showEmail && <Typography variant="caption">{member.email}</Typography>}
      </div>
      {canManage ? (
        <div className={styles.memberRowActions}>
          <Button variant="ghost" size="sm" disabled={pending} onClick={toggleRole}>
            {isOwnerRow ? 'Make member' : 'Make owner'}
          </Button>
          <Button variant="ghost" size="sm" disabled={pending} onClick={remove}>
            Remove
          </Button>
        </div>
      ) : (
        isOwnerRow && (
          <Typography variant="caption" className={styles.memberRoleBadge}>
            Owner
          </Typography>
        )
      )}
    </li>
  );
}

function MemberPicker({
  projectId,
  onError,
}: {
  projectId: string;
  onError: (message: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<DirectoryUser[]>([]);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const trimmedQuery = query.trim();
  const searched = trimmedQuery.length >= MIN_QUERY_LENGTH;

  useEffect(() => {
    if (!searched) {
      setResults([]);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(() => {
      searchProjectMemberCandidates({ projectId, query: trimmedQuery })
        .then((users) => {
          if (!cancelled) setResults(users);
        })
        .catch(() => {
          if (!cancelled) setResults([]);
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [projectId, trimmedQuery]);

  function add(user: DirectoryUser): void {
    setAddingId(user.id);
    void addProjectMember({ projectId, userId: user.id })
      .then((result) => {
        if (result.ok) {
          setQuery('');
          setResults([]);
        } else {
          onError(result.error);
        }
      })
      .finally(() => setAddingId(null));
  }

  return (
    <div className={styles.memberPicker}>
      <Typography variant="label">Add a person</Typography>
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by name or email"
        autoComplete="off"
      />
      {searched && searching && (
        <Typography variant="caption" className={styles.memberResultStatus}>
          Searching…
        </Typography>
      )}
      {searched && !searching && results.length === 0 && (
        <Typography variant="caption" className={styles.memberResultStatus}>
          No matches
        </Typography>
      )}
      {results.length > 0 && (
        <ul className={styles.memberResults}>
          {results.map((user) => (
            <li key={user.id}>
              <button
                type="button"
                className={styles.memberResultRow}
                disabled={addingId === user.id}
                onClick={() => add(user)}
              >
                <Avatar name={user.name ?? user.email} src={user.image ?? undefined} size="sm" />
                <div className={styles.memberInfo}>
                  <Typography variant="body">{user.name ?? user.email}</Typography>
                  {user.name && <Typography variant="caption">{user.email}</Typography>}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Folded in from the previous standalone delete confirm dialog — a project
 * owner's one destructive action, deliberately separated visually (its own
 * tinted section) from the edit/share affordances above it, matching the
 * "configure-once concerns live in a clearly separated settings area"
 * principle rather than sitting as its own icon on the daily listing.
 */
function DangerZone({ project, onDeleted }: { project: HomeProject; onDeleted: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const boardCount = project.boards.length;

  return (
    <div className={styles.manageSection}>
      <Typography variant="label" className={styles.dangerZoneLabel}>
        Danger zone
      </Typography>
      <div className={styles.dangerZoneBox}>
        <div>
          <Typography variant="body">Delete this project</Typography>
          <Typography variant="caption">
            {boardCount > 0
              ? `Deletes ${boardCount === 1 ? '1 board' : `${boardCount} boards`} and everything on them. Can’t be undone.`
              : 'Can’t be undone.'}
          </Typography>
        </div>
        <Button variant="destructive" size="sm" onClick={() => setConfirming(true)}>
          Delete
        </Button>
      </div>

      {confirming && (
        <ConfirmDialog
          open
          onClose={() => setConfirming(false)}
          title={`Delete "${project.name}"?`}
          message={
            <>
              This deletes the project{' '}
              {boardCount > 0
                ? `and its ${boardCount === 1 ? 'board' : `${boardCount} boards`}, including every list, card, and comment on them. `
                : 'permanently. '}
              This can&apos;t be undone.
            </>
          }
          destructive
          confirmLabel={pending ? 'Deleting…' : 'Delete project'}
          pending={pending}
          error={error}
          onConfirm={() => {
            setError(null);
            startTransition(async () => {
              const result = await deleteProject({ projectId: project.id });
              if (result.ok) onDeleted();
              else setError(result.error);
            });
          }}
        />
      )}
    </div>
  );
}
