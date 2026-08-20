import { PageContainer, Spinner } from '@sovereignfs/ui';
import styles from '../../kanban.module.css';

export default function BoardLoading() {
  return (
    <PageContainer maxWidth="full">
      <div className={styles.centered}>
        <Spinner aria-label="Loading board" />
      </div>
    </PageContainer>
  );
}
