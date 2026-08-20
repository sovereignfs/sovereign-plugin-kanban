'use client';

import { useState, useTransition } from 'react';
import { Avatar, Button, Textarea, Typography, useToast } from '@sovereignfs/ui';
import { addComment } from '../actions';
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
 */
export function CardComments({
  card,
  members,
  currentUser,
}: {
  card: CardDetail;
  members: BoardData['members'];
  currentUser: CurrentUser;
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

  return (
    <section className={styles.cardSection}>
      {/* No "Comments" label here — the tab strip above (`CardCommentsActivity`)
          already names this section on both surfaces now; a second label
          directly under an already-selected tab was pure duplication. */}
      {topLevel.length === 0 ? (
        <Typography variant="caption" className={styles.descriptionPlaceholder}>
          No comments yet.
        </Typography>
      ) : (
        <ul className={styles.commentList}>
          {topLevel.map((comment) => (
            <li key={comment.id}>
              <CommentRow
                comment={comment}
                members={members}
                currentUser={currentUser}
                cardId={card.id}
                onError={onError}
                canReply
              />
              {(repliesByParent.get(comment.id) ?? []).length > 0 && (
                <ul className={styles.commentReplies}>
                  {(repliesByParent.get(comment.id) ?? []).map((reply) => (
                    <li key={reply.id}>
                      <CommentRow
                        comment={reply}
                        members={members}
                        currentUser={currentUser}
                        cardId={card.id}
                        onError={onError}
                        canReply={false}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}

      <CommentComposer cardId={card.id} onError={onError} />
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
}: {
  comment: Comment;
  members: BoardData['members'];
  currentUser: CurrentUser;
  cardId: string;
  onError: (message: string) => void;
  canReply: boolean;
}) {
  const [replying, setReplying] = useState(false);
  const author = displayName(comment.authorId, currentUser, members);
  const authorImage = members.find((m) => m.userId === comment.authorId)?.image ?? undefined;

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
          </Typography>
        </div>
        {/* `.commentText` (`white-space: pre-wrap`) — same underlying bug
            class as the card description's own `Markdown` fix: a comment
            is written in a plain multi-line `<textarea>`
            (`CommentComposer` below), but rendered here as ordinary text,
            whose CSS default (`white-space: normal`) collapses every
            typed newline into a single space, same as any plain HTML
            text node. Not routed through `Markdown` — a comment isn't
            markdown source, just plain text that needs its own line
            breaks preserved. */}
        <Typography variant="body" className={styles.commentText}>
          {comment.body}
        </Typography>
        {canReply && (
          <div className={styles.commentActions}>
            <Button variant="ghost" size="sm" onClick={() => setReplying((v) => !v)}>
              Reply
            </Button>
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
    </div>
  );
}

function CommentComposer({
  cardId,
  parentId = null,
  focusOnOpen = false,
  placeholder = 'Write a comment…',
  onError,
  onDone,
}: {
  cardId: string;
  parentId?: string | null;
  focusOnOpen?: boolean;
  placeholder?: string;
  onError: (message: string) => void;
  onDone?: () => void;
}) {
  const [value, setValue] = useState('');
  const [pending, startTransition] = useTransition();

  function submit(): void {
    const body = value.trim();
    if (!body) return;
    startTransition(async () => {
      const result = await addComment({ cardId, body, parentId });
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
        // eslint-disable-next-line jsx-a11y/no-autofocus -- only set on a reply composer opened from the user's own "Reply" click, never on page load
        autoFocus={focusOnOpen}
        rows={2}
        value={value}
        placeholder={placeholder}
        disabled={pending}
        onChange={(e) => setValue(e.target.value)}
      />
      <div className={styles.composerActions}>
        <Button size="sm" variant="primary" onClick={submit} loading={pending} disabled={!value.trim()}>
          {parentId ? 'Reply' : 'Comment'}
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
