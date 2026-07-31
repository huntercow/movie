package com.movie.ticket.job;

import com.movie.ticket.security.UserScopeContext;
import com.movie.ticket.service.OrderSubmitService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class OrderJobServiceTest {

    @AfterEach
    void clearContext() {
        UserScopeContext.clear();
    }

    @Test
    void enqueuePersistsUserScopeAndIsIdempotent() {
        JobTaskRepository jobs = mock(JobTaskRepository.class);
        when(jobs.findByTaskTypeAndBusinessKey(JobTaskType.ORDER_SUBMIT, "O100"))
                .thenReturn(Optional.empty(), Optional.of(new JobTask()));
        when(jobs.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
        OrderJobService service = new OrderJobService(jobs, mock(OrderSubmitService.class));
        UserScopeContext.set(22L);

        service.enqueueOrderSubmit("O100");
        service.enqueueOrderSubmit("O100");

        var captor = org.mockito.ArgumentCaptor.forClass(JobTask.class);
        verify(jobs, times(1)).save(captor.capture());
        assertThat(captor.getValue().getUserId()).isEqualTo(22L);
        assertThat(captor.getValue().getStatus()).isEqualTo(JobTaskStatus.PENDING);
        assertThat(captor.getValue().getBusinessKey()).isEqualTo("O100");
        verify(jobs, never()).delete(any());
    }
}
