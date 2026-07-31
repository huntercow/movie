package com.movie.ticket.service;

import com.movie.ticket.config.XianyuProperties;
import com.movie.ticket.dto.OrderResponse;
import com.movie.ticket.dto.XianyuDeliveryResultRequest;
import com.movie.ticket.entity.XianyuDeliveryAttemptOutcome;
import com.movie.ticket.entity.XianyuDeliveryRecord;
import com.movie.ticket.entity.XianyuFulfillmentStatus;
import com.movie.ticket.entity.XianyuPlatformOrder;
import com.movie.ticket.exception.BusinessException;
import com.movie.ticket.repository.XianyuBuyerRepository;
import com.movie.ticket.repository.XianyuConversationRepository;
import com.movie.ticket.repository.XianyuDeliveryRecordRepository;
import com.movie.ticket.repository.XianyuMessageRepository;
import com.movie.ticket.repository.XianyuPlatformOrderRepository;
import com.movie.ticket.security.UserScopeContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class XianyuDeliveryAttemptServiceTest {

    private static final long USER_ID = 44L;

    @BeforeEach
    void setUserScope() {
        UserScopeContext.set(USER_ID);
    }

    @AfterEach
    void clearUserScope() {
        UserScopeContext.clear();
    }

    @Test
    void firstClaimPersistsAttemptBeforeGrantAndRepeatedClaimCannotReplayOrExposeTickets() {
        var deps = newDeps();
        var order = readyOrder();
        when(deps.platformOrders.findByUserIdAndPlatformOrderIdForUpdate(USER_ID, "ORDER_001"))
                .thenReturn(Optional.of(order));
        when(deps.platformOrders.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
        when(deps.orderService.getOrder("LOCAL_001")).thenReturn(issuedLocalOrder());

        var first = deps.service.claimDelivery("ORDER_001");
        var repeated = deps.service.claimDelivery("ORDER_001");

        assertThat(order.getStatus()).isEqualTo(XianyuFulfillmentStatus.DELIVERY_OUTCOME_PENDING);
        assertThat(order.getDeliveryAttemptId()).isNotBlank();
        assertThat(order.getDeliveryAttemptStartedAt()).isNotNull();
        assertThat(first.deliveryAttemptId()).isEqualTo(order.getDeliveryAttemptId());
        assertThat(first.shouldPoll()).isFalse();
        assertThat(first.shouldDeliver()).isTrue();
        assertThat(first.ticketCodeInfo()).contains("123456");
        assertThat(repeated.deliveryAttemptId()).isEqualTo(first.deliveryAttemptId());
        assertThat(repeated.shouldPoll()).isFalse();
        assertThat(repeated.shouldDeliver()).isFalse();
        assertThat(repeated.deliveryMessage()).isNull();
        assertThat(repeated.ticketCodeInfo()).isNull();
        assertThat(repeated.order()).isNull();
        verify(deps.platformOrders, times(1)).save(order);
    }

    @Test
    void claimRejectsNonDeliverableOrInconsistentAttemptState() {
        var deps = newDeps();
        var wrongStatus = readyOrder();
        wrongStatus.setStatus(XianyuFulfillmentStatus.TICKETING);
        when(deps.platformOrders.findByUserIdAndPlatformOrderIdForUpdate(USER_ID, "ORDER_001"))
                .thenReturn(Optional.of(wrongStatus));

        assertThatThrownBy(() -> deps.service.claimDelivery("ORDER_001"))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("not ready");

        var inconsistent = readyOrder();
        inconsistent.setDeliveryAttemptId("ATTEMPT_001");
        when(deps.platformOrders.findByUserIdAndPlatformOrderIdForUpdate(USER_ID, "ORDER_001"))
                .thenReturn(Optional.of(inconsistent));
        assertThatThrownBy(() -> deps.service.claimDelivery("ORDER_001"))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("attempt state");
    }

    @Test
    void pendingRecoveryExcludesStartedAttemptAndOrdinaryReadRedactsDeliveryData() {
        var deps = newDeps();
        var order = pendingAttemptOrder("ATTEMPT_001");
        when(deps.platformOrders.findTop50ByUserIdAndStatusInOrderByUpdatedAtAsc(org.mockito.ArgumentMatchers.eq(USER_ID), any()))
                .thenReturn(List.of(order));
        when(deps.platformOrders.findByUserIdAndPlatformOrderId(USER_ID, "ORDER_001"))
                .thenReturn(Optional.of(order));

        assertThat(deps.service.listPendingDeliveries()).isEmpty();
        var read = deps.service.getOrder("ORDER_001");
        assertThat(read.status()).isEqualTo(XianyuFulfillmentStatus.DELIVERY_OUTCOME_PENDING);
        assertThat(read.shouldPoll()).isFalse();
        assertThat(read.shouldDeliver()).isFalse();
        assertThat(read.deliveryMessage()).isNull();
        assertThat(read.ticketCodeInfo()).isNull();
        assertThat(read.order()).isNull();
        verify(deps.orderService, never()).getOrder(any());
    }

    @Test
    void identicalSuccessOutcomeIsIdempotentButDifferentOutcomeOrAttemptConflicts() {
        var deps = newDeps();
        var order = pendingAttemptOrder("ATTEMPT_001");
        when(deps.platformOrders.findByUserIdAndPlatformOrderIdForUpdate(USER_ID, "ORDER_001"))
                .thenReturn(Optional.of(order));
        when(deps.platformOrders.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
        when(deps.deliveryRecords.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
        when(deps.orderService.getOrder("LOCAL_001")).thenReturn(issuedLocalOrder());

        var request = new XianyuDeliveryResultRequest("ATTEMPT_001", true, "xianyu-mtop", "");
        var first = deps.service.recordDelivery("ORDER_001", request);
        var duplicate = deps.service.recordDelivery("ORDER_001", request);

        assertThat(first.status()).isEqualTo(XianyuFulfillmentStatus.DELIVERED);
        assertThat(first.deliveryAttemptOutcome()).isEqualTo(XianyuDeliveryAttemptOutcome.SUCCESS);
        assertThat(duplicate.status()).isEqualTo(XianyuFulfillmentStatus.DELIVERED);
        verify(deps.deliveryRecords, times(1)).save(any());

        assertThatThrownBy(() -> deps.service.recordDelivery("ORDER_001", new XianyuDeliveryResultRequest(
                "ATTEMPT_001", false, "xianyu-mtop", "TICKET_CODE_SEND_FAILED"
        ))).isInstanceOf(BusinessException.class).hasMessageContaining("outcome conflict");
        assertThatThrownBy(() -> deps.service.recordDelivery("ORDER_001", new XianyuDeliveryResultRequest(
                "ATTEMPT_001", true, "different-channel", ""
        ))).isInstanceOf(BusinessException.class).hasMessageContaining("outcome conflict");
        assertThatThrownBy(() -> deps.service.recordDelivery("ORDER_001", new XianyuDeliveryResultRequest(
                "ATTEMPT_002", true, "xianyu-mtop", ""
        ))).isInstanceOf(BusinessException.class).hasMessageContaining("attempt id mismatch");
    }

    @Test
    void identicalFailureOutcomeIsIdempotentButDifferentSummaryConflicts() {
        var deps = newDeps();
        var order = pendingAttemptOrder("ATTEMPT_001");
        when(deps.platformOrders.findByUserIdAndPlatformOrderIdForUpdate(USER_ID, "ORDER_001"))
                .thenReturn(Optional.of(order));
        when(deps.platformOrders.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
        when(deps.deliveryRecords.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
        when(deps.orderService.getOrder("LOCAL_001")).thenReturn(issuedLocalOrder());

        var request = new XianyuDeliveryResultRequest(
                "ATTEMPT_001", false, "xianyu-mtop", "DUMMY_CONSIGN_FAILED"
        );
        var first = deps.service.recordDelivery("ORDER_001", request);
        var duplicate = deps.service.recordDelivery("ORDER_001", request);

        assertThat(first.status()).isEqualTo(XianyuFulfillmentStatus.NEED_MANUAL);
        assertThat(first.deliveryAttemptOutcome()).isEqualTo(XianyuDeliveryAttemptOutcome.FAILURE);
        assertThat(duplicate.status()).isEqualTo(XianyuFulfillmentStatus.NEED_MANUAL);
        verify(deps.deliveryRecords, times(1)).save(any());

        assertThatThrownBy(() -> deps.service.recordDelivery("ORDER_001", new XianyuDeliveryResultRequest(
                "ATTEMPT_001", false, "xianyu-mtop", "DELIVERY_TEMPLATE_FAILED"
        ))).isInstanceOf(BusinessException.class).hasMessageContaining("outcome conflict");
    }

    @Test
    void resultRequiresPendingAttemptAndNeverPersistsRawPayload() {
        var deps = newDeps();
        var noAttempt = readyOrder();
        when(deps.platformOrders.findByUserIdAndPlatformOrderIdForUpdate(USER_ID, "ORDER_001"))
                .thenReturn(Optional.of(noAttempt));

        assertThatThrownBy(() -> deps.service.recordDelivery("ORDER_001", new XianyuDeliveryResultRequest(
                "ATTEMPT_001", true, "xianyu-mtop", ""
        ))).isInstanceOf(BusinessException.class).hasMessageContaining("attempt");

        var pending = pendingAttemptOrder("ATTEMPT_001");
        when(deps.platformOrders.findByUserIdAndPlatformOrderIdForUpdate(USER_ID, "ORDER_001"))
                .thenReturn(Optional.of(pending));
        when(deps.platformOrders.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
        when(deps.deliveryRecords.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
        when(deps.orderService.getOrder("LOCAL_001")).thenReturn(issuedLocalOrder());

        deps.service.recordDelivery("ORDER_001", new XianyuDeliveryResultRequest(
                "ATTEMPT_001", true, "xianyu-mtop", ""
        ));

        ArgumentCaptor<XianyuDeliveryRecord> captor = ArgumentCaptor.forClass(XianyuDeliveryRecord.class);
        verify(deps.deliveryRecords).save(captor.capture());
        assertThat(captor.getValue().getDeliveryAttemptId()).isEqualTo("ATTEMPT_001");
        assertThat(XianyuDeliveryRecord.class.getDeclaredFields())
                .extracting(field -> field.getName())
                .doesNotContain("rawPayload");
    }

    private Deps newDeps() {
        XianyuPlatformOrderRepository platformOrders = mock(XianyuPlatformOrderRepository.class);
        XianyuDeliveryRecordRepository deliveryRecords = mock(XianyuDeliveryRecordRepository.class);
        OrderService orderService = mock(OrderService.class);
        return new Deps(
                new XianyuService(
                        mock(XianyuBuyerRepository.class),
                        mock(XianyuConversationRepository.class),
                        mock(XianyuMessageRepository.class),
                        platformOrders,
                        deliveryRecords,
                        mock(QuoteService.class),
                        orderService,
                        new XianyuProperties(true)
                ),
                platformOrders,
                deliveryRecords,
                orderService
        );
    }

    private XianyuPlatformOrder readyOrder() {
        XianyuPlatformOrder order = new XianyuPlatformOrder();
        order.setPlatformOrderId("ORDER_001");
        order.setChatId("CHAT_001");
        order.setBuyerUserId("BUYER_001");
        order.setLocalOrderNo("LOCAL_001");
        order.setStatus(XianyuFulfillmentStatus.ISSUED_WAIT_DELIVER);
        return order;
    }

    private XianyuPlatformOrder pendingAttemptOrder(String attemptId) {
        XianyuPlatformOrder order = readyOrder();
        order.setStatus(XianyuFulfillmentStatus.DELIVERY_OUTCOME_PENDING);
        order.setDeliveryAttemptId(attemptId);
        order.setDeliveryAttemptStartedAt(LocalDateTime.of(2026, 7, 30, 12, 0));
        return order;
    }

    private OrderResponse issuedLocalOrder() {
        return new OrderResponse(
                "LOCAL_001", "QUOTE_001", "CUSTOMER_001",
                new BigDecimal("88.00"), new BigDecimal("88.00"),
                "UPSTREAM_ID", "UPSTREAM_NO", 6, "取票码: 123456", 1,
                null, null, "ISSUED", "ISSUED", true, false
        );
    }

    private record Deps(
            XianyuService service,
            XianyuPlatformOrderRepository platformOrders,
            XianyuDeliveryRecordRepository deliveryRecords,
            OrderService orderService
    ) {
    }
}
