'use client';

import { useState, useTransition } from 'react';
import { Avatar, Button, ConfirmDialog, Textarea, Typography, useToast } from '@sovereignfs/ui';
import { addComment, deleteComment, updateComment } from '../actions';
import { displayName } from '../_lib/identity';
import type { BoardData, CardDetail } from '../_lib/queries';
import type { CurrentUser } from './BoardView';
import styles from '../kanban.module.css';
import { TimeAgo } from './TimeAgo';

type Comment = CardDetail['comments'][number];

/**
 * Comments support one level of replies (schema note on
 * `kanban_comments.parent_id`) — a reply's "Reply" affordance is simply not
 * rendered, so the UI can't produce a nesting depth the server would reject.
 *
 * Authors can edit and delete their own comments; a board owner
 * (`canModerate`) can delete anyone's. `canEdit` false (K.21) hides every
 * composer and per-comment action.
 */
export function CardComments({
  card,
  members,
  currentUser,
  canEdit,
  canModerate,
}: {
  card: CardDetail;
  members: BoardData['members'];
  currentUser: CurrentUser;
  canEdit: boolean;
  canModerate: boolean;
}) {
  const toast = useToast();
  const topLevel = card.comments.filter((c) => c.parentId === null);
  const repliesByParent = new Map<string, Comment[]>();
  for (const comment of card.comments) {
    if (comment.parentId === null) continue;
    const list = repliesByParent.get(comment.parentId) ?? [];
    list.push(comment);
    repliesByParent.set(comment.parentId, list);
  }

  function onError(message: string): void {
    toast.show({ title: 'Comment failed', message, category: 'error' });
  }

  const rowProps = { members, currentUser, cardId: card.id, onError, canEdit, canModerate };

  return (
    <section className={styles.cardSection}>
      {topLevel.length === 0 ? (
        <Typography variant="caption" className={styles.descriptionPlaceholder}>
          No comments yet.
        </Typography>
      ) : (
        <ul className={styles.commentList}>
          {topLevel.map((comment) => (
            <li key={comment.id}>
              <CommentRow comment={comment} canReply {...rowProps} />
              {(repliesByParent.get(comment.id) ?? []).length > 0 && (
                <ul className={styles.commentReplies}>
                  {(repliesByParent.get(comment.id) ?? []).map((reply) => (
                    <li key={reply.id}>
                      <CommentRow comment={reply} canReply={false} {...rowProps} />
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}

      {canEdit && <CommentComposer cardId={card.id} onError={onError} />}
    </section>
  );
}

function CommentRow({
  comment,
  members,
  currentUser,
  cardId,
  onError,
  canReply,
  canEdit,
  canModerate,
}: {
  comment: Comment;
  members: BoardData['members'];
  currentUser: CurrentUser;
  cardId: string;
  onError: (message: string) => void;
  canReply: boolean;
  canEdit: boolean;
  canModerate: boolean;
}) {
  const [replying, setReplying] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, startDelete] = useTransition();
  const author = displayName(comment.authorId, currentUser, members);
  const authorImage = members.find((m) => m.userId === comment.authorId)?.image ?? undefined;
  const isOwn = comment.authorId === currentUser.id;
  const canDelete = canEdit && (isOwn || canModerate);
  const edited = comment.updatedAt > comment.createdAt;

  return (
    <div className={styles.commentRow}>
      <Avatar name={author} src={authorImage} size="sm" />
      <div className={styles.commentBody}>
        <div className={styles.commentMeta}>
          <Typography variant="body" as="strong">
            {author}
          </Typography>
          <Typography variant="caption">
            <TimeAgo ms={comment.createdAt} />
            {edited && <span className={styles.commentEdited}> · edited</span>}
          </Typography>
        </div>
        {editing ? (
          <CommentComposer
            cardId={cardId}
            editingCommentId={comment.id}
            initialValue={comment.body}
            focusOnOpen
            onError={onError}
            onDone={() => setEditing(false)}
          />
        ) : (
          // `.commentText` (`white-space: pre-wrap`) — a comment is written
          // in a multi-line textarea, so its typed newlines must survive.
          <Typography variant="body" className={styles.commentText}>
            {comment.body}
          </Typography>
        )}
        {canEdit && !editing && (
          <div className={styles.commentActions}>
            {canReply && (
              <Button variant="ghost" size="sm" onClick={() => setReplying((v) => !v)}>
                Reply
              </Button>
            )}
            {isOwn && (
              <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
                Edit
              </Button>
            )}
            {canDelete && (
              <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)}>
                Delete
              </Button>
            )}
          </div>
        )}
        {replying && (
          <CommentComposer
            cardId={cardId}
            parentId={comment.id}
            focusOnOpen
            placeholder="Write a reply…"
            onError={onError}
            onDone={() => setReplying(false)}
          />
        )}
      </div>

      {confirmDelete && (
        <ConfirmDialog
          open
          onClose={() => setConfirmDelete(false)}
          title="Delete this comment?"
          message={
            canReply
              ? 'Its replies are deleted with it. This can’t be undone.'
              : 'This can’t be undone.'
          }
          destructive
          confirmLabel={deleting ? 'Deleting…' : 'Delete comment'}
          pending={deleting}
          onConfirm={() => {
            startDelete(async () => {
              const result = await deleteComment({ commentId: comment.id });
              if (!result.ok) onError(result.error);
              setConfirmDelete(false);
            });
          }}
        />
      )}
    </div>
  );
}

/**
 * One composer for three jobs: a new top-level comment, a reply
 * (`parentId`), or an in-place edit (`editingCommentId` + `initialValue`).
 */
function CommentComposer({
  cardId,
  parentId = null,
  editingCommentId = null,
  initialValue = '',
  focusOnOpen = false,
  placeholder = 'Write a comment…',
  onError,
  onDone,
}: {
  cardId: string;
  parentId?: string | null;
  editingCommentId?: string | null;
  initialValue?: string;
  focusOnOpen?: boolean;
  placeholder?: string;
  onError: (message: string) => void;
  onDone?: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  const [pending, startTransition] = useTransition();

  function submit(): void {
    const body = value.trim();
    if (!body) return;
    startTransition(async () => {
      const result = editingCommentId
        ? await updateComment({ commentId: editingCommentId, body })
        : await addComment({ cardId, body, parentId });
      if (result.ok) {
        setValue('');
        onDone?.();
      } else {
        onError(result.error);
      }
    });
  }

  return (
    <div className={styles.commentComposer}>
      <Textarea
        // eslint-disable-next-line jsx-a11y/no-autofocus -- only set on a reply/edit composer opened from the user's own click, never on page load
        autoFocus={focusOnOpen}
        rows={2}
        value={value}
        placeholder={placeholder}
        disabled={pending}
        onChange={(e) => setValue(e.target.value)}
      />
      <div className={styles.composerActions}>
        <Button
          size="sm"
          variant="primary"
          onClick={submit}
          loading={pending}
          disabled={!value.trim()}
        >
          {editingCommentId ? 'Save' : parentId ? 'Reply' : 'Comment'}
        </Button>
        {onDone && (
          <Button size="sm" variant="secondary" onClick={onDone} disabled={pending}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}
