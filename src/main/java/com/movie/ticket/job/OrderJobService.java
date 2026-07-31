package com.movie.ticket.job;

import com.movie.ticket.security.UserScopeContext;
import com.movie.ticket.service.OrderSubmitService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.lang.management.ManagementFactory;
import java.time.LocalDateTime;
import java.util.List;

@Service
public class OrderJobService {

    private static final List<JobTaskStatus> READY_STATUSES = List.of(JobTaskStatus.PENDING);
    private static final java.time.Duration CLAIM_DURATION = java.time.Duration.ofMinutes(5);

    private final JobTaskRepository repository;
    private final OrderSubmitService orderSubmitService;
    private final String workerId = ManagementFactory.getRuntimeMXBean().getName();

    public OrderJobService(JobTaskRepository repository, OrderSubmitService orderSubmitService) {
        this.repository = repository;
        this.orderSubmitService = orderSubmitService;
    }

    @Transactional
    public void enqueueOrderSubmit(String orderNo) {
        if (repository.findByTaskTypeAndBusinessKey(JobTaskType.ORDER_SUBMIT, orderNo).isPresent()) {
            return;
        }
        JobTask task = new JobTask();
        task.setUserId(UserScopeContext.get());
        task.setTaskType(JobTaskType.ORDER_SUBMIT);
        task.setBusinessKey(orderNo);
        task.setPayloadJson("{\"orderNo\":\"" + orderNo + "\"}");
        task.setStatus(JobTaskStatus.PENDING);
        task.setAttemptCount(0);
        task.setNextRunAt(LocalDateTime.now());
        repository.save(task);
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public Long claimNext() {
        LocalDateTime now = LocalDateTime.now();
        JobTask task = repository.findFirstByStatusInAndNextRunAtLessThanEqualOrderByCreatedAtAsc(READY_STATUSES, now)
                .orElse(null);
        if (task == null) {
            return null;
        }
        task.setStatus(JobTaskStatus.RUNNING);
        task.setAttemptCount(task.getAttemptCount() + 1);
        task.setLockedBy(workerId);
        task.setLockedUntil(now.plus(CLAIM_DURATION));
        repository.save(task);
        return task.getId();
    }

    public void execute(Long taskId) {
        JobTask task = repository.findById(taskId).orElse(null);
        if (task == null || task.getStatus() != JobTaskStatus.RUNNING) {
            return;
        }
        try {
            UserScopeContext.set(task.getUserId());
            orderSubmitService.processInitialSubmit(task.getBusinessKey());
            markSucceeded(taskId);
        } catch (RuntimeException exception) {
            markFailed(taskId, exception.getMessage());
        } finally {
            UserScopeContext.clear();
        }
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void markSucceeded(Long taskId) {
        repository.findById(taskId).ifPresent(task -> {
            task.setStatus(JobTaskStatus.SUCCEEDED);
            task.setLockedBy(null);
            task.setLockedUntil(null);
            task.setLastError(null);
            repository.save(task);
        });
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void markFailed(Long taskId, String error) {
        repository.findById(taskId).ifPresent(task -> {
            task.setStatus(JobTaskStatus.FAILED);
            task.setLockedBy(null);
            task.setLockedUntil(null);
            task.setLastError(error == null ? "unexpected worker failure" : error);
            repository.save(task);
        });
    }
}
