package com.movie.ticket.job;

import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;

import java.time.LocalDateTime;
import java.util.Collection;
import java.util.Optional;
import java.util.List;

public interface JobTaskRepository extends JpaRepository<JobTask, Long> {
    Optional<JobTask> findByTaskTypeAndBusinessKey(JobTaskType taskType, String businessKey);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    Optional<JobTask> findFirstByStatusInAndNextRunAtLessThanEqualOrderByCreatedAtAsc(
            Collection<JobTaskStatus> statuses,
            LocalDateTime now
    );

    List<JobTask> findTop100ByOrderByCreatedAtDesc();
}
