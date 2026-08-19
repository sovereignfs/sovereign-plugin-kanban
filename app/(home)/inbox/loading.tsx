import { PageContainer, Spinner } from '@sovereignfs/ui';
import styles from '../../kanban.module.css';

export default function InboxLoading() {
  return (
    <PageContainer maxWidth="lg">
      <div className={styles.centered}>
        <Spinner aria-label="Loading inbox" />
      </div>
    </PageContainer>
  );
}
