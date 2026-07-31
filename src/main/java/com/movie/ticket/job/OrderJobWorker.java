package com.movie.ticket.job;

import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class OrderJobWorker {

    private final OrderJobService jobService;

    public OrderJobWorker(OrderJobService jobService) {
        this.jobService = jobService;
    }

    @Scheduled(fixedDelayString = "${ticket.jobs.poll-delay:1000}")
    public void poll() {
        for (int index = 0; index < 10; index++) {
            Long taskId = jobService.claimNext();
            if (taskId == null) {
                return;
            }
            jobService.execute(taskId);
        }
    }
}
