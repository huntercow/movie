package com.movie.ticket.job;

import java.time.LocalDateTime;

public record JobTaskView(
        Long id,
        Long userId,
        JobTaskType taskType,
        String businessKey,
        JobTaskStatus status,
        int attemptCount,
        LocalDateTime nextRunAt,
        String lockedBy,
        LocalDateTime lockedUntil,
        String lastError,
        LocalDateTime createdAt,
        LocalDateTime updatedAt
) {
    public static JobTaskView from(JobTask task) {
        return new JobTaskView(
                task.getId(), task.getUserId(), task.getTaskType(), task.getBusinessKey(), task.getStatus(),
                task.getAttemptCount(), task.getNextRunAt(), task.getLockedBy(), task.getLockedUntil(),
                task.getLastError(), task.getCreatedAt(), task.getUpdatedAt()
        );
    }
}
