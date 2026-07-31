package com.movie.ticket.service;

import com.movie.ticket.config.XianyuProperties;
import com.movie.ticket.dto.MovieTicketInfo;
import com.movie.ticket.dto.OrderResponse;
import com.movie.ticket.dto.QuoteResponse;
import com.movie.ticket.dto.XianyuDeliveryResultRequest;
import com.movie.ticket.dto.XianyuAdjustedOrderRequest;
import com.movie.ticket.dto.XianyuEventRequest;
import com.movie.ticket.dto.XianyuImageMessageRequest;
import com.movie.ticket.dto.XianyuManualOrderRequest;
import com.movie.ticket.dto.XianyuPaidVerificationRequest;
import com.movie.ticket.dto.XianyuVerificationFailureRequest;
import com.movie.ticket.dto.XianyuWaitingPaymentRequest;
import com.movie.ticket.entity.XianyuConversation;
import com.movie.ticket.entity.XianyuAmountVerificationSource;
import com.movie.ticket.entity.XianyuDeliveryAttemptOutcome;
import com.movie.ticket.entity.XianyuFulfillmentStatus;
import com.movie.ticket.entity.XianyuMessage;
import com.movie.ticket.entity.XianyuPlatformOrder;
import com.movie.ticket.entity.XianyuVerificationFailureCode;
import com.movie.ticket.exception.BusinessException;
import com.movie.ticket.repository.XianyuBuyerRepository;
import com.movie.ticket.repository.XianyuConversationRepository;
import com.movie.ticket.repository.XianyuDeliveryRecordRepository;
import com.movie.ticket.repository.XianyuMessageRepository;
import com.movie.ticket.repository.XianyuPlatformOrderRepository;
import com.movie.ticket.security.UserScopeContext;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.mockito.junit.jupiter.MockitoExtension;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class XianyuServiceTest {

    private static final long USER_ID = 1L;

    @BeforeEach
    void setUserScope() {
        UserScopeContext.set(USER_ID);
    }

    @AfterEach
    void clearUserScope() {
        UserScopeContext.clear();
    }

    @Test
    void registerWaitingPaymentPersistsQuoteAndExactCents() {
        var deps = newDeps();
        var conversation = conversation("chat-1", "Q1");
        var savedOrder = new AtomicReference<XianyuPlatformOrder>();
        when(deps.conversationRepository.findByChatIdForUpdate("chat-1")).thenReturn(Optional.of(conversation));
        when(deps.conversationRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
        when(deps.platformOrderRepository.findByPlatformOrderIdForUpdate("order-1")).thenReturn(Optional.empty());
        when(deps.platformOrderRepository.findByChatIdAndStatusInForUpdate(any(), any())).thenReturn(List.of());
        when(deps.quoteService.getQuote("Q1")).thenReturn(quote("Q1", "88.00"));
        when(deps.platformOrderRepository.save(any())).thenAnswer(invocation -> {
            XianyuPlatformOrder order = invocation.getArgument(0);
            savedOrder.set(order);
            return order;
        });

        var result = deps.service.registerWaitingPayment(waitingPaymentRequest("order-1", "chat-1"));

        assertThat(result.totalPriceCents()).isEqualTo(8800L);
        assertThat(result.quoteNo()).isEqualTo("Q1");
        assertThat(result.status()).isEqualTo(XianyuFulfillmentStatus.WAIT_BUYER_PAY);
        assertThat(savedOrder.get().getStatus()).isEqualTo(XianyuFulfillmentStatus.WAIT_BUYER_PAY);
        assertThat(savedOrder.get().getQuotedAmount()).isEqualByComparingTo("88.00");
    }

    @Test
    void registerWaitingPaymentRejectsMismatchedQuoteNumber() {
        var deps = newDeps();
        when(deps.conversationRepository.findByChatIdForUpdate("chat-1"))
                .thenReturn(Optional.of(conversation("chat-1", "Q1")));
        when(deps.conversationRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
        when(deps.platformOrderRepository.findByPlatformOrderIdForUpdate("order-1")).thenReturn(Optional.empty());
        when(deps.platformOrderRepository.findByChatIdAndStatusInForUpdate(any(), any())).thenReturn(List.of());
        when(deps.quoteService.getQuote("Q1")).thenReturn(quote("Q2", "88.00"));

        assertThatThrownBy(() -> deps.service.registerWaitingPayment(waitingPaymentRequest("order-1", "chat-1")))
                .isInstanceOf(BusinessException.class)
                .hasMessage("quote number does not match xianyu conversation latest quote");
        verify(deps.platformOrderRepository, never()).save(any());
    }

    @Test
    void registerWaitingPaymentRejectsMissingQuoteNumber() {
        var deps = newDeps();
        when(deps.conversationRepository.findByChatIdForUpdate("chat-1"))
                .thenReturn(Optional.of(conversation("chat-1", "Q1")));
        when(deps.conversationRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
        when(deps.platformOrderRepository.findByPlatformOrderIdForUpdate("order-1")).thenReturn(Optional.empty());
        when(deps.platformOrderRepository.findByChatIdAndStatusInForUpdate(any(), any())).thenReturn(List.of());
        when(deps.quoteService.getQuote("Q1")).thenReturn(quote(null, "88.00"));

        assertThatThrownBy(() -> deps.service.registerWaitingPayment(waitingPaymentRequest("order-1", "chat-1")))
                .isInstanceOf(BusinessException.class)
                .hasMessage("quote response is missing quote number");
        verify(deps.platformOrderRepository, never()).save(any());
    }

    @Test
    void duplicateWaitingPaymentForSameOrderIsIdempotent() {
        var deps = newDeps();
        var conversation = conversation("chat-1", "Q1");
        var savedOrder = new AtomicReference<XianyuPlatformOrder>();
        when(deps.conversationRepository.findByChatIdForUpdate("chat-1")).thenReturn(Optional.of(conversation));
        when(deps.conversationRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
        when(deps.platformOrderRepository.findByPlatformOrderIdForUpdate("order-1"))
                .thenAnswer(invocation -> Optional.ofNullable(savedOrder.get()));
        when(deps.platformOrderRepository.findByChatIdAndStatusInForUpdate(any(), any())).thenReturn(List.of());
        when(deps.quoteService.getQuote("Q1")).thenReturn(quote("Q1", "88.00"));
        when(deps.platformOrderRepository.save(any())).thenAnswer(invocation -> {
            XianyuPlatformOrder order = invocation.getArgument(0);
            savedOrder.set(order);
            return order;
        });

        var request = waitingPaymentRequest("order-1", "chat-1");
        var first = deps.service.registerWaitingPayment(request);
        var second = deps.service.registerWaitingPayment(request);

        assertThat(first.status()).isEqualTo(XianyuFulfillmentStatus.WAIT_BUYER_PAY);
        assertThat(second.status()).isEqualTo(XianyuFulfillmentStatus.WAIT_BUYER_PAY);
        assertThat(savedOrder.get().getQuotedAmount()).isEqualByComparingTo("88.00");
        verify(deps.platformOrderRepository, times(1)).save(any());
        verify(deps.quoteService, times(1)).getQuote("Q1");
    }

    @Test
    void duplicateWaitingPaymentFailsWhenChatHasMultipleActiveOrders() {
        var deps = newDeps();
        var existingOrder = waitingOrder("order-1", "chat-1", "88.00");
        when(deps.conversationRepository.findByChatIdForUpdate("chat-1"))
                .thenReturn(Optional.of(conversation("chat-1", "Q1")));
        when(deps.conversationRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
        when(deps.platformOrderRepository.findByPlatformOrderIdForUpdate("order-1"))
                .thenReturn(Optional.of(existingOrder));
        when(deps.platformOrderRepository.findByChatIdAndStatusInForUpdate(any(), any())).thenReturn(List.of(
                existingOrder,
                waitingOrder("order-2", "chat-1", "88.00")
        ));

        assertThatThrownBy(() -> deps.service.registerWaitingPayment(waitingPaymentRequest("order-1", "chat-1")))
                .isInstanceOf(BusinessException.class)
                .hasMessage("multiple active xianyu orders found for chat");
        verify(deps.platformOrderRepository, never()).save(any());
        verify(deps.quoteService, never()).getQuote(any());
    }

    @Test
    void differentActiveOrderInSameChatIsBlocked() {
        var deps = newDeps();
        var conversation = conversation("chat-1", "Q1");
        var activeOrder = waitingOrder("existing-order", "chat-1", "88.00");
        var savedOrder = new AtomicReference<XianyuPlatformOrder>();
        when(deps.conversationRepository.findByChatIdForUpdate("chat-1")).thenReturn(Optional.of(conversation));
        when(deps.conversationRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
        when(deps.platformOrderRepository.findByPlatformOrderIdForUpdate("new-order")).thenReturn(Optional.empty());
        when(deps.platformOrderRepository.findByChatIdAndStatusInForUpdate(any(), any()))
                .thenReturn(List.of(activeOrder));
        when(deps.quoteService.getQuote("Q1")).thenReturn(quote("Q1", "88.00"));
        when(deps.platformOrderRepository.save(any())).thenAnswer(invocation -> {
            XianyuPlatformOrder order = invocation.getArgument(0);
            savedOrder.set(order);
            return order;
        });

        var result = deps.service.registerWaitingPayment(waitingPaymentRequest("new-order", "chat-1"));

        assertThat(result.platformOrderId()).isEqualTo("new-order");
        assertThat(result.status()).isEqualTo(XianyuFulfillmentStatus.NEED_MANUAL);
        assertThat(savedOrder.get()).isNotSameAs(activeOrder);
        assertThat(savedOrder.get().getStatus()).isEqualTo(XianyuFulfillmentStatus.NEED_MANUAL);
        assertThat(activeOrder.getStatus()).isEqualTo(XianyuFulfillmentStatus.WAIT_BUYER_PAY);
    }

    @Test
    void multipleActiveOrdersInSameChatFailExplicitly() {
        var deps = newDeps();
        when(deps.conversationRepository.findByChatIdForUpdate("chat-1"))
                .thenReturn(Optional.of(conversation("chat-1", "Q1")));
        when(deps.conversationRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
        when(deps.platformOrderRepository.findByPlatformOrderIdForUpdate("new-order")).thenReturn(Optional.empty());
        when(deps.platformOrderRepository.findByChatIdAndStatusInForUpdate(any(), any())).thenReturn(List.of(
                waitingOrder("existing-1", "chat-1", "88.00"),
                waitingOrder("existing-2", "chat-1", "88.00")
        ));

        assertThatThrownBy(() -> deps.service.registerWaitingPayment(waitingPaymentRequest("new-order", "chat-1")))
                .isInstanceOf(BusinessException.class)
                .hasMessage("multiple active xianyu orders found for chat");
        verify(deps.platformOrderRepository, never()).save(any());
        verify(deps.quoteService, never()).getQuote(any());
    }

    @Test
    void waitingPaymentLookupUsesCurrentUserScope() {
        var deps = newDeps();
        UserScopeContext.set(44L);
        try {
            org.mockito.Mockito.doReturn(Optional.of(conversation("chat-1", "Q1")))
                    .when(deps.conversationRepository).findByUserIdAndChatIdForUpdate(44L, "chat-1");
            when(deps.conversationRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
            org.mockito.Mockito.doReturn(Optional.empty())
                    .when(deps.platformOrderRepository).findByUserIdAndPlatformOrderIdForUpdate(44L, "order-1");
            org.mockito.Mockito.doReturn(List.of())
                    .when(deps.platformOrderRepository).findByUserIdAndChatIdAndStatusInForUpdate(any(), any(), any());
            when(deps.quoteService.getQuote("Q1")).thenReturn(quote("Q1", "88.00"));
            when(deps.platformOrderRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));

            deps.service.registerWaitingPayment(waitingPaymentRequest("order-1", "chat-1"));

            verify(deps.conversationRepository).findByUserIdAndChatIdForUpdate(44L, "chat-1");
            verify(deps.platformOrderRepository).findByUserIdAndPlatformOrderIdForUpdate(44L, "order-1");
            verify(deps.platformOrderRepository)
                    .findByUserIdAndChatIdAndStatusInForUpdate(eq(44L), eq("chat-1"), any());
            verify(deps.conversationRepository, never()).findByChatIdForUpdate(any());
            verify(deps.platformOrderRepository, never()).findByPlatformOrderIdForUpdate(any());
            verify(deps.platformOrderRepository, never()).findByChatIdAndStatusInForUpdate(any(), any());
        } finally {
            UserScopeContext.clear();
        }
    }

    @Test
    void resolveWaitingPaymentOrderRequiresExactlyOneAdjustedOrder() {
        var deps = newDeps();
        var adjusted = waitingOrder("order-1", "chat-1", "88.00");
        adjusted.setAdjustedAmount(new BigDecimal("88.00"));
        adjusted.setAdjustedAt(LocalDateTime.now());
        var missingAdjustedAt = waitingOrder("order-2", "chat-1", "88.00");
        missingAdjustedAt.setAdjustedAmount(new BigDecimal("88.00"));
        var missingAdjustedAmount = waitingOrder("order-3", "chat-1", "88.00");
        missingAdjustedAmount.setAdjustedAt(LocalDateTime.now());
        when(deps.platformOrderRepository.findByChatIdAndStatus("chat-1", XianyuFulfillmentStatus.WAIT_BUYER_PAY))
                .thenReturn(
                        List.of(adjusted),
                        List.of(),
                        List.of(adjusted, waitingOrder("order-4", "chat-1", "88.00")),
                        List.of(missingAdjustedAt),
                        List.of(missingAdjustedAmount)
                );

        assertThat(deps.service.resolveWaitingPaymentOrder("chat-1").platformOrderId()).isEqualTo("order-1");
        assertThatThrownBy(() -> deps.service.resolveWaitingPaymentOrder("chat-1"))
                .isInstanceOf(BusinessException.class);
        assertThatThrownBy(() -> deps.service.resolveWaitingPaymentOrder("chat-1"))
                .isInstanceOf(BusinessException.class)
                .hasMessage("multiple active xianyu orders found for chat");
        assertThatThrownBy(() -> deps.service.resolveWaitingPaymentOrder("chat-1"))
                .isInstanceOf(BusinessException.class);
        assertThatThrownBy(() -> deps.service.resolveWaitingPaymentOrder("chat-1"))
                .isInstanceOf(BusinessException.class);
    }

    @Test
    void waitingPaymentQuoteCentsConversionIsExact() {
        var exactDeps = newDeps();
        stubWaitingPaymentRegistration(exactDeps, "0.01");
        assertThat(exactDeps.service.registerWaitingPayment(waitingPaymentRequest("order-1", "chat-1"))
                .totalPriceCents()).isEqualTo(1L);

        var roundingDeps = newDeps();
        stubWaitingPaymentRegistration(roundingDeps, "88.001");
        assertThatThrownBy(() -> roundingDeps.service.registerWaitingPayment(waitingPaymentRequest("order-1", "chat-1")))
                .isInstanceOf(ArithmeticException.class);

        var overflowDeps = newDeps();
        stubWaitingPaymentRegistration(overflowDeps, "92233720368547758.08");
        assertThatThrownBy(() -> overflowDeps.service.registerWaitingPayment(waitingPaymentRequest("order-1", "chat-1")))
                .isInstanceOf(ArithmeticException.class);
    }

    @Test
    void recordAdjustedPersistsExactAmount() {
        var deps = newDeps();
        var platformOrder = waitingOrder("order-1", "chat-1", "88.00");
        when(deps.platformOrderRepository.findByPlatformOrderIdForUpdate("order-1"))
                .thenReturn(Optional.of(platformOrder));
        when(deps.platformOrderRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));

        var result = deps.service.recordAdjusted("order-1", new XianyuAdjustedOrderRequest(8800L));

        assertThat(result.adjustedAmount()).isEqualByComparingTo("88.00");
        assertThat(result.adjustedAt()).isNotNull();
        assertThat(result.status()).isEqualTo(XianyuFulfillmentStatus.WAIT_BUYER_PAY);
    }

    @Test
    void duplicateAdjustedEvidenceForSameAmountIsIdempotent() {
        var deps = newDeps();
        var platformOrder = waitingOrder("order-1", "chat-1", "88.00");
        var firstAdjustedAt = LocalDateTime.of(2026, 7, 29, 12, 0);
        platformOrder.setAdjustedAmount(new BigDecimal("88.00"));
        platformOrder.setAdjustedAt(firstAdjustedAt);
        when(deps.platformOrderRepository.findByPlatformOrderIdForUpdate("order-1"))
                .thenReturn(Optional.of(platformOrder));

        var result = deps.service.recordAdjusted("order-1", new XianyuAdjustedOrderRequest(8800L));

        assertThat(result.adjustedAmount()).isEqualByComparingTo("88.00");
        assertThat(result.adjustedAt()).isEqualTo(firstAdjustedAt);
        assertThat(result.status()).isEqualTo(XianyuFulfillmentStatus.WAIT_BUYER_PAY);
        verify(deps.platformOrderRepository, never()).save(any());
    }

    @Test
    void differentAdjustedEvidenceNeedsManual() {
        var deps = newDeps();
        var platformOrder = waitingOrder("order-1", "chat-1", "88.00");
        var firstAdjustedAt = LocalDateTime.of(2026, 7, 29, 12, 0);
        platformOrder.setAdjustedAmount(new BigDecimal("88.00"));
        platformOrder.setAdjustedAt(firstAdjustedAt);
        when(deps.platformOrderRepository.findByPlatformOrderIdForUpdate("order-1"))
                .thenReturn(Optional.of(platformOrder));
        when(deps.platformOrderRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));

        var result = deps.service.recordAdjusted("order-1", new XianyuAdjustedOrderRequest(8700L));

        assertThat(result.status()).isEqualTo(XianyuFulfillmentStatus.NEED_MANUAL);
        assertThat(result.adjustedAmount()).isEqualByComparingTo("88.00");
        assertThat(result.adjustedAt()).isEqualTo(firstAdjustedAt);
        assertThat(result.lastError()).contains("adjusted amount").contains("quote");
    }

    @Test
    void recordAdjustedRejectsNonPositiveCentsAtServiceBoundary() {
        var deps = newDeps();

        assertThatThrownBy(() -> deps.service.recordAdjusted("order-1", new XianyuAdjustedOrderRequest(0L)))
                .isInstanceOf(BusinessException.class)
                .hasMessage("adjustedAmountCents must be positive");
        assertThatThrownBy(() -> deps.service.recordAdjusted("order-1", new XianyuAdjustedOrderRequest(-1L)))
                .isInstanceOf(BusinessException.class)
                .hasMessage("adjustedAmountCents must be positive");
        verify(deps.platformOrderRepository, never()).findByPlatformOrderIdForUpdate(any());
    }

    @Test
    void recordAdjustedRejectsOrderOutsideWaitingPaymentState() {
        var deps = newDeps();
        var platformOrder = waitingOrder("order-1", "chat-1", "88.00");
        platformOrder.setStatus(XianyuFulfillmentStatus.PAID_WAIT_SUBMIT);
        when(deps.platformOrderRepository.findByPlatformOrderIdForUpdate("order-1"))
                .thenReturn(Optional.of(platformOrder));

        assertThatThrownBy(() -> deps.service.recordAdjusted("order-1", new XianyuAdjustedOrderRequest(8800L)))
                .isInstanceOf(BusinessException.class);
        verify(deps.platformOrderRepository, never()).save(any());
    }

    @Test
    void duplicateImageMessageReturnsExistingQuote() {
        var deps = newDeps();
        XianyuConversation conversation = new XianyuConversation();
        conversation.setChatId("chat-1");
        XianyuMessage message = new XianyuMessage();
        message.setChatId("chat-1");
        message.setMessageId("msg-1");
        message.setQuoteNo("Q1");
        when(deps.conversationRepository.findByChatIdForUpdate("chat-1")).thenReturn(Optional.of(conversation));
        when(deps.messageRepository.findByChatIdAndMessageId("chat-1", "msg-1")).thenReturn(Optional.of(message));
        when(deps.quoteService.getQuote("Q1")).thenReturn(quote("Q1", "88.00"));

        var result = deps.service.createQuoteFromImage(new XianyuImageMessageRequest(
                "chat-1", "msg-1", "buyer-1", "buyer", "seller-1", "item-1", null, "base64", "{}"
        ));

        assertThat(result.duplicated()).isTrue();
        assertThat(result.quoteNo()).isEqualTo("Q1");
    }

    @Test
    void verifiedAmountsCreateExactlyOneLocalOrder() {
        var deps = newDeps();
        XianyuPlatformOrder platformOrder = adjustedOrder("ORDER_001", "88.00");
        when(deps.platformOrderRepository.findByPlatformOrderIdForUpdate("ORDER_001"))
                .thenReturn(Optional.of(platformOrder));
        when(deps.orderService.createOrder(any())).thenReturn(order("O1", "Q1", "PAID", false));
        when(deps.platformOrderRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));

        var result = deps.service.verifyPaid("ORDER_001", paidVerificationRequest(8800L, 8800L, 0L));

        assertThat(result.status()).isEqualTo(XianyuFulfillmentStatus.PAID_WAIT_SUBMIT);
        assertThat(result.paidAmount()).isEqualByComparingTo("88.00");
        assertThat(result.localOrderNo()).isEqualTo("O1");
        verify(deps.orderService, times(1)).createOrder(any());
    }

    @Test
    void verifyPaidRejectsNullPostFeeWhenBeanValidationIsBypassed() {
        var deps = newDeps();
        XianyuPaidVerificationRequest request = new XianyuPaidVerificationRequest(
                8800L,
                8800L,
                null,
                XianyuAmountVerificationSource.XIANYU_ORDER_DETAIL_PRICE_INFO_AMOUNT
        );

        assertThatThrownBy(() -> deps.service.verifyPaid("ORDER_001", request))
                .isInstanceOf(BusinessException.class)
                .hasMessage("postFeeCents is required");
        verify(deps.platformOrderRepository, never()).findByPlatformOrderIdForUpdate(any());
    }

    @Test
    void actualPaidAmountMismatchNeedsManualWithoutCreatingOrder() {
        var deps = newDeps();
        XianyuPlatformOrder platformOrder = adjustedOrder("ORDER_001", "88.00");
        when(deps.platformOrderRepository.findByPlatformOrderIdForUpdate("ORDER_001"))
                .thenReturn(Optional.of(platformOrder));
        when(deps.platformOrderRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));

        var result = deps.service.verifyPaid("ORDER_001", paidVerificationRequest(8800L, 8700L, 0L));

        assertThat(result.status()).isEqualTo(XianyuFulfillmentStatus.NEED_MANUAL);
        assertThat(result.lastError()).contains("paid amount does not match item total plus post fee");
        verify(deps.orderService, never()).createOrder(any());
    }

    @Test
    void nonZeroPostFeeNeedsManualWithoutCreatingOrder() {
        var deps = newDeps();
        XianyuPlatformOrder platformOrder = adjustedOrder("ORDER_001", "88.00");
        when(deps.platformOrderRepository.findByPlatformOrderIdForUpdate("ORDER_001"))
                .thenReturn(Optional.of(platformOrder));
        when(deps.platformOrderRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));

        var result = deps.service.verifyPaid("ORDER_001", paidVerificationRequest(8800L, 8700L, 100L));

        assertThat(result.status()).isEqualTo(XianyuFulfillmentStatus.NEED_MANUAL);
        assertThat(result.lastError()).contains("post fee must be zero");
        verify(deps.orderService, never()).createOrder(any());
    }

    @Test
    void missingAdjustedAtNeedsManualWithoutCreatingOrder() {
        var deps = newDeps();
        XianyuPlatformOrder platformOrder = adjustedOrder("ORDER_001", "88.00");
        platformOrder.setAdjustedAt(null);
        when(deps.platformOrderRepository.findByPlatformOrderIdForUpdate("ORDER_001"))
                .thenReturn(Optional.of(platformOrder));
        when(deps.platformOrderRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));

        var result = deps.service.verifyPaid("ORDER_001", paidVerificationRequest(8800L, 8800L, 0L));

        assertThat(result.status()).isEqualTo(XianyuFulfillmentStatus.NEED_MANUAL);
        assertThat(result.lastError()).contains("adjustment is missing");
        verify(deps.orderService, never()).createOrder(any());
    }

    @Test
    void duplicatePaidVerificationRequiresIdenticalEvidenceAndIsIdempotent() {
        var deps = newDeps();
        XianyuPlatformOrder platformOrder = adjustedOrder("ORDER_001", "88.00");
        when(deps.platformOrderRepository.findByPlatformOrderIdForUpdate("ORDER_001"))
                .thenReturn(Optional.of(platformOrder));
        when(deps.orderService.createOrder(any())).thenReturn(order("O1", "Q1", "PAID", false));
        when(deps.orderService.getOrder("O1")).thenReturn(order("O1", "Q1", "PAID", false));
        when(deps.platformOrderRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));

        var request = paidVerificationRequest(8800L, 8800L, 0L);
        var first = deps.service.verifyPaid("ORDER_001", request);
        var second = deps.service.verifyPaid("ORDER_001", request);

        assertThat(first.localOrderNo()).isEqualTo("O1");
        assertThat(second.localOrderNo()).isEqualTo("O1");
        verify(deps.orderService, times(1)).createOrder(any());
    }

    @Test
    void duplicatePaidVerificationWithDifferentAmountFails() {
        var deps = newDeps();
        XianyuPlatformOrder platformOrder = adjustedOrder("ORDER_001", "88.00");
        platformOrder.setPaidAmount(new BigDecimal("88.00"));
        platformOrder.setPaidAt(LocalDateTime.of(2026, 7, 29, 12, 0));
        platformOrder.setAmountVerificationSource(XianyuAmountVerificationSource.XIANYU_ORDER_DETAIL_PRICE_INFO_AMOUNT);
        platformOrder.setAmountVerifiedAt(LocalDateTime.of(2026, 7, 29, 12, 0));
        platformOrder.setLocalOrderNo("O1");
        platformOrder.setStatus(XianyuFulfillmentStatus.PAID_WAIT_SUBMIT);
        when(deps.platformOrderRepository.findByPlatformOrderIdForUpdate("ORDER_001"))
                .thenReturn(Optional.of(platformOrder));

        assertThatThrownBy(() -> deps.service.verifyPaid("ORDER_001", paidVerificationRequest(1L, 1L, 0L)))
                .isInstanceOf(BusinessException.class);

        assertThat(platformOrder.getPaidAmount()).isEqualByComparingTo("88.00");
        assertThat(platformOrder.getLocalOrderNo()).isEqualTo("O1");
        verify(deps.orderService, never()).createOrder(any());
        verify(deps.platformOrderRepository, never()).save(any());
    }

    @Test
    void verifiedPaymentStopsBeforeCreateOrderWhenAutoFulfillmentDisabled() {
        var deps = newDeps(false);
        XianyuPlatformOrder platformOrder = adjustedOrder("ORDER_001", "88.00");
        when(deps.platformOrderRepository.findByPlatformOrderIdForUpdate("ORDER_001"))
                .thenReturn(Optional.of(platformOrder));
        when(deps.platformOrderRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));

        var result = deps.service.verifyPaid("ORDER_001", paidVerificationRequest(8800L, 8800L, 0L));

        assertThat(result.status()).isEqualTo(XianyuFulfillmentStatus.NEED_MANUAL);
        assertThat(result.lastError()).contains("auto fulfillment is disabled");
        assertThat(platformOrder.getPaidAmount()).isEqualByComparingTo("88.00");
        verify(deps.orderService, never()).createOrder(any());
    }

    @Test
    void duplicatePaidVerificationRejectsCompletedOrderMissingPaidAt() {
        assertCompletedVerificationIsRejected(platformOrder -> platformOrder.setPaidAt(null));
    }

    @Test
    void duplicatePaidVerificationRejectsCompletedOrderMissingAmountVerifiedAt() {
        assertCompletedVerificationIsRejected(platformOrder -> platformOrder.setAmountVerifiedAt(null));
    }

    @Test
    void duplicatePaidVerificationRejectsCompletedOrderMissingAdjustedAt() {
        assertCompletedVerificationIsRejected(platformOrder -> platformOrder.setAdjustedAt(null));
    }

    @Test
    void duplicatePaidVerificationRejectsCompletedOrderWithMismatchedQuotedAndAdjustedAmounts() {
        assertCompletedVerificationIsRejected(platformOrder -> platformOrder.setAdjustedAmount(new BigDecimal("87.00")));
    }

    @Test
    void duplicatePaidVerificationRejectsCompletedOrderWithMismatchedAdjustedAndPaidAmounts() {
        assertCompletedVerificationIsRejected(platformOrder -> platformOrder.setPaidAmount(new BigDecimal("87.00")));
    }

    @Test
    void duplicatePaidVerificationRejectsCompletedOrderStillWaitingForBuyerPayment() {
        assertCompletedVerificationIsRejected(platformOrder -> platformOrder.setStatus(XianyuFulfillmentStatus.WAIT_BUYER_PAY));
    }

    @Test
    void duplicatePaidVerificationAcceptsCompleteEvidenceForFulfillmentAndTerminalStatuses() {
        var deps = newDeps();
        XianyuPlatformOrder platformOrder = completedVerifiedOrder();
        when(deps.platformOrderRepository.findByPlatformOrderIdForUpdate("ORDER_001"))
                .thenReturn(Optional.of(platformOrder));

        var fulfillment = deps.service.verifyPaid("ORDER_001", paidVerificationRequest(8800L, 8800L, 0L));
        platformOrder.setStatus(XianyuFulfillmentStatus.DELIVERED);
        var terminal = deps.service.verifyPaid("ORDER_001", paidVerificationRequest(8800L, 8800L, 0L));

        assertThat(fulfillment.localOrderNo()).isEqualTo("O1");
        assertThat(terminal.localOrderNo()).isEqualTo("O1");
        verify(deps.platformOrderRepository, never()).save(any());
        verify(deps.orderService, never()).createOrder(any());
    }

    @Test
    void localOrderCreationFailureIsPropagatedWithoutSavingPlatformOrder() {
        var deps = newDeps();
        XianyuPlatformOrder platformOrder = adjustedOrder("ORDER_001", "88.00");
        when(deps.platformOrderRepository.findByPlatformOrderIdForUpdate("ORDER_001"))
                .thenReturn(Optional.of(platformOrder));
        when(deps.orderService.createOrder(any())).thenThrow(new BusinessException("local order creation failed"));

        assertThatThrownBy(() -> deps.service.verifyPaid("ORDER_001", paidVerificationRequest(8800L, 8800L, 0L)))
                .isInstanceOf(BusinessException.class)
                .hasMessage("local order creation failed");

        verify(deps.platformOrderRepository, never()).save(any());
    }

    @Test
    void nullLocalOrderResponseFailsWithoutSavingPlatformOrder() {
        assertInvalidLocalOrderResponseIsRejected(null);
    }

    @Test
    void blankLocalOrderNumberFailsWithoutSavingPlatformOrder() {
        assertInvalidLocalOrderResponseIsRejected(order(" ", "Q1", "PAID", false));
    }

    @Test
    void missingLocalOrderQuoteNumberFailsWithoutSavingPlatformOrder() {
        assertInvalidLocalOrderResponseIsRejected(order("O1", null, "PAID", false));
    }

    @Test
    void mismatchedLocalOrderQuoteNumberFailsWithoutSavingPlatformOrder() {
        assertInvalidLocalOrderResponseIsRejected(order("O1", "OTHER", "PAID", false));
    }

    @ParameterizedTest
    @EnumSource(XianyuVerificationFailureCode.class)
    void verificationFailureCodesRequireManualReviewWithoutCreatingOrder(XianyuVerificationFailureCode code) {
        var deps = newDeps();
        XianyuPlatformOrder platformOrder = adjustedOrder("ORDER_001", "88.00");
        when(deps.platformOrderRepository.findByPlatformOrderIdForUpdate("ORDER_001"))
                .thenReturn(Optional.of(platformOrder));
        when(deps.platformOrderRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));

        var result = deps.service.recordVerificationFailure("ORDER_001", new XianyuVerificationFailureRequest(code));

        assertThat(result.status()).isEqualTo(XianyuFulfillmentStatus.NEED_MANUAL);
        assertThat(result.lastError()).isNotBlank();
        verify(deps.orderService, never()).createOrder(any());
    }

    @Test
    void verificationFailureRejectsWrongStateAndExistingLocalOrder() {
        var wrongStateDeps = newDeps();
        XianyuPlatformOrder wrongState = adjustedOrder("ORDER_001", "88.00");
        wrongState.setStatus(XianyuFulfillmentStatus.PAID_WAIT_SUBMIT);
        when(wrongStateDeps.platformOrderRepository.findByPlatformOrderIdForUpdate("ORDER_001"))
                .thenReturn(Optional.of(wrongState));

        assertThatThrownBy(() -> wrongStateDeps.service.recordVerificationFailure(
                "ORDER_001", new XianyuVerificationFailureRequest(XianyuVerificationFailureCode.AMOUNT_MISMATCH)
        )).isInstanceOf(BusinessException.class);
        verify(wrongStateDeps.platformOrderRepository, never()).save(any());

        var completedDeps = newDeps();
        when(completedDeps.platformOrderRepository.findByPlatformOrderIdForUpdate("ORDER_001"))
                .thenReturn(Optional.of(completedVerifiedOrder()));
        assertThatThrownBy(() -> completedDeps.service.recordVerificationFailure(
                "ORDER_001", new XianyuVerificationFailureRequest(XianyuVerificationFailureCode.AMOUNT_MISMATCH)
        )).isInstanceOf(BusinessException.class);
        verify(completedDeps.platformOrderRepository, never()).save(any());
    }

    @Test
    void verificationFailureRejectsNullRequestAndNullCode() {
        var deps = newDeps();

        assertThatThrownBy(() -> deps.service.recordVerificationFailure("ORDER_001", null))
                .isInstanceOf(BusinessException.class);
        assertThatThrownBy(() -> deps.service.recordVerificationFailure("ORDER_001", new XianyuVerificationFailureRequest(null)))
                .isInstanceOf(BusinessException.class);
        verify(deps.platformOrderRepository, never()).findByPlatformOrderIdForUpdate(any());
    }


    @Test
    void issuedLocalOrderBecomesPendingDelivery() {
        var deps = newDeps();
        var platformOrder = existingPaidOrder();
        when(deps.platformOrderRepository.findByPlatformOrderId("trade-1")).thenReturn(Optional.of(platformOrder));
        when(deps.orderService.getOrder("O1")).thenReturn(order("O1", "Q1", "ISSUED", true));
        when(deps.platformOrderRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));

        var result = deps.service.getOrder("trade-1");

        assertThat(result.status()).isEqualTo(XianyuFulfillmentStatus.ISSUED_WAIT_DELIVER);
        assertThat(result.shouldDeliver()).isTrue();
        assertThat(result.deliveryMessage()).contains("出票成功").contains("取票码");
        assertThat(result.ticketCodeInfo()).contains("取票码");
    }

    @Test
    void successfulDeliveryRecordMarksOrderDelivered() {
        var deps = newDeps();
        var platformOrder = existingPaidOrder();
        platformOrder.setStatus(XianyuFulfillmentStatus.DELIVERY_OUTCOME_PENDING);
        platformOrder.setDeliveryAttemptId("ATTEMPT_001");
        platformOrder.setDeliveryAttemptStartedAt(LocalDateTime.now());
        when(deps.platformOrderRepository.findByPlatformOrderIdForUpdate("trade-1")).thenReturn(Optional.of(platformOrder));
        when(deps.deliveryRecordRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
        when(deps.platformOrderRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
        when(deps.orderService.getOrder("O1")).thenReturn(order("O1", "Q1", "ISSUED", false));

        var result = deps.service.recordDelivery("trade-1", new XianyuDeliveryResultRequest(
                "ATTEMPT_001",
                true,
                "xianyu-mtop",
                ""
        ));

        assertThat(result.status()).isEqualTo(XianyuFulfillmentStatus.DELIVERED);
        assertThat(result.shouldPoll()).isFalse();
        assertThat(platformOrder.getDeliveredAt()).isNotNull();
        verify(deps.deliveryRecordRepository).save(any());
    }

    @Test
    void duplicateSuccessfulDeliveryCallbackIsIdempotent() {
        var deps = newDeps();
        var platformOrder = existingPaidOrder();
        platformOrder.setStatus(XianyuFulfillmentStatus.DELIVERED);
        platformOrder.setDeliveryAttemptId("ATTEMPT_001");
        platformOrder.setDeliveryAttemptStartedAt(LocalDateTime.now().minusMinutes(1));
        platformOrder.setDeliveryAttemptOutcome(XianyuDeliveryAttemptOutcome.SUCCESS);
        platformOrder.setDeliveryAttemptChannel("xianyu-mtop");
        platformOrder.setDeliveryAttemptErrorMessage("");
        platformOrder.setDeliveryOutcomeRecordedAt(LocalDateTime.now());
        when(deps.platformOrderRepository.findByPlatformOrderIdForUpdate("trade-1")).thenReturn(Optional.of(platformOrder));
        when(deps.orderService.getOrder("O1")).thenReturn(order("O1", "Q1", "ISSUED", false));

        var result = deps.service.recordDelivery("trade-1", new XianyuDeliveryResultRequest(
                "ATTEMPT_001", true, "xianyu-mtop", ""
        ));

        assertThat(result.status()).isEqualTo(XianyuFulfillmentStatus.DELIVERED);
        verify(deps.deliveryRecordRepository, never()).save(any());
    }

    @Test
    void deliveredPlatformOrderIsNotRegressedByLocalIssuedStatus() {
        var deps = newDeps();
        var platformOrder = existingPaidOrder();
        platformOrder.setStatus(XianyuFulfillmentStatus.DELIVERED);
        when(deps.platformOrderRepository.findByPlatformOrderId("trade-1")).thenReturn(Optional.of(platformOrder));
        when(deps.orderService.getOrder("O1")).thenReturn(order("O1", "Q1", "ISSUED", false));

        var result = deps.service.getOrder("trade-1");

        assertThat(result.status()).isEqualTo(XianyuFulfillmentStatus.DELIVERED);
        verify(deps.platformOrderRepository, never()).save(any());
    }

    @Test
    void onlyOnePersistedDeliveryAttemptIsGranted() {
        var deps = newDeps();
        var platformOrder = existingPaidOrder();
        platformOrder.setStatus(XianyuFulfillmentStatus.ISSUED_WAIT_DELIVER);
        when(deps.platformOrderRepository.findByPlatformOrderIdForUpdate("trade-1")).thenReturn(Optional.of(platformOrder));
        when(deps.platformOrderRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
        when(deps.orderService.getOrder("O1")).thenReturn(order("O1", "Q1", "ISSUED", false));

        var first = deps.service.claimDelivery("trade-1");
        var second = deps.service.claimDelivery("trade-1");

        assertThat(first.shouldDeliver()).isTrue();
        assertThat(second.shouldDeliver()).isFalse();
        assertThat(platformOrder.getDeliveryAttemptId()).isNotBlank();
        assertThat(platformOrder.getDeliveryAttemptStartedAt()).isNotNull();
        assertThat(platformOrder.getStatus()).isEqualTo(XianyuFulfillmentStatus.DELIVERY_OUTCOME_PENDING);
    }

    @Test
    void listEventsReturnsRecentMessagesForChat() {
        var deps = newDeps();
        XianyuMessage message = new XianyuMessage();
        message.setId(1L);
        message.setChatId("chat-1");
        message.setMessageId("event-1");
        message.setMessageType("ADJUST_PRICE_FAILED");
        message.setRawPayload("{\"reason\":\"mtop failed\"}");
        when(deps.messageRepository.findTop100ByChatIdOrderByCreatedAtDesc("chat-1")).thenReturn(List.of(message));

        var result = deps.service.listEvents("chat-1");

        assertThat(result).hasSize(1);
        assertThat(result.get(0).messageType()).isEqualTo("ADJUST_PRICE_FAILED");
        assertThat(result.get(0).rawPayload()).contains("mtop failed");
    }

    @Test
    void listEventsWithoutChatReturnsRecentMessages() {
        var deps = newDeps();
        XianyuMessage message = new XianyuMessage();
        message.setId(2L);
        message.setChatId("chat-2");
        message.setMessageId("event-2");
        message.setMessageType("DELIVERY_RESULT");
        when(deps.messageRepository.findTop100ByOrderByCreatedAtDesc()).thenReturn(List.of(message));

        var result = deps.service.listEvents("");

        assertThat(result).hasSize(1);
        assertThat(result.get(0).chatId()).isEqualTo("chat-2");
    }

    @Test
    void recordEventWithoutMessageIdFailsFast() {
        var deps = newDeps();
        assertThatThrownBy(() -> deps.service.recordEvent(new XianyuEventRequest(
                        "ADJUST_PRICE_FAILED",
                        "chat-1",
                        "trade-1",
                        null,
                        "{\"reason\":\"mtop failed\"}"
                )))
                .isInstanceOf(BusinessException.class)
                .hasMessage("messageId is required");
    }

    @Test
    void manualRefundSettlesOrder() {
        var deps = newDeps();
        var platformOrder = new XianyuPlatformOrder();
        platformOrder.setPlatformOrderId("trade-1");
        platformOrder.setChatId("chat-1");
        platformOrder.setStatus(XianyuFulfillmentStatus.NEED_MANUAL);
        platformOrder.setLastError("出票失败");
        when(deps.platformOrderRepository.findByPlatformOrderIdForUpdate("trade-1")).thenReturn(Optional.of(platformOrder));
        when(deps.platformOrderRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));

        var result = deps.service.updateManualOrder("trade-1", new XianyuManualOrderRequest(
                XianyuFulfillmentStatus.REFUNDED,
                "已人工退款"
        ));

        assertThat(result.status()).isEqualTo(XianyuFulfillmentStatus.REFUNDED);
        assertThat(result.lastError()).isEqualTo("已人工退款");
    }

    private Deps newDeps() {
        return newDeps(true);
    }

    private Deps newDeps(Boolean autoFulfillmentEnabled) {
        XianyuBuyerRepository buyerRepository = mock(XianyuBuyerRepository.class);
        XianyuConversationRepository conversationRepository = mock(XianyuConversationRepository.class);
        XianyuMessageRepository messageRepository = mock(XianyuMessageRepository.class);
        XianyuPlatformOrderRepository platformOrderRepository = mock(XianyuPlatformOrderRepository.class);
        XianyuDeliveryRecordRepository deliveryRecordRepository = mock(XianyuDeliveryRecordRepository.class);
        QuoteService quoteService = mock(QuoteService.class);
        OrderService orderService = mock(OrderService.class);
        bridgeUserScopedQueries(
                buyerRepository,
                conversationRepository,
                messageRepository,
                platformOrderRepository
        );
        XianyuService service = new XianyuService(
                buyerRepository,
                conversationRepository,
                messageRepository,
                platformOrderRepository,
                deliveryRecordRepository,
                quoteService,
                orderService,
                new XianyuProperties(autoFulfillmentEnabled)
        );
        return new Deps(
                service,
                conversationRepository,
                messageRepository,
                platformOrderRepository,
                deliveryRecordRepository,
                orderService,
                quoteService
        );
    }

    private void bridgeUserScopedQueries(
            XianyuBuyerRepository buyers,
            XianyuConversationRepository conversations,
            XianyuMessageRepository messages,
            XianyuPlatformOrderRepository orders
    ) {
        lenient().when(buyers.findByUserIdAndBuyerUserId(any(), any()))
                .thenAnswer(invocation -> buyers.findByBuyerUserId(invocation.getArgument(1)));
        lenient().when(conversations.findByUserIdAndChatId(any(), any()))
                .thenAnswer(invocation -> conversations.findByChatId(invocation.getArgument(1)));
        lenient().when(conversations.findByUserIdAndChatIdForUpdate(any(), any()))
                .thenAnswer(invocation -> conversations.findByChatIdForUpdate(invocation.getArgument(1)));
        lenient().when(messages.findByUserIdAndChatIdAndMessageId(any(), any(), any()))
                .thenAnswer(invocation -> messages.findByChatIdAndMessageId(
                        invocation.getArgument(1), invocation.getArgument(2)));
        lenient().when(messages.findTop100ByUserIdAndChatIdOrderByCreatedAtDesc(any(), any()))
                .thenAnswer(invocation -> messages.findTop100ByChatIdOrderByCreatedAtDesc(invocation.getArgument(1)));
        lenient().when(messages.findTop100ByUserIdOrderByCreatedAtDesc(any()))
                .thenAnswer(invocation -> messages.findTop100ByOrderByCreatedAtDesc());
        lenient().when(orders.findByUserIdAndPlatformOrderId(any(), any()))
                .thenAnswer(invocation -> orders.findByPlatformOrderId(invocation.getArgument(1)));
        lenient().when(orders.findByUserIdAndPlatformOrderIdForUpdate(any(), any()))
                .thenAnswer(invocation -> orders.findByPlatformOrderIdForUpdate(invocation.getArgument(1)));
        lenient().when(orders.findByUserIdAndChatIdAndStatusInForUpdate(any(), any(), any()))
                .thenAnswer(invocation -> orders.findByChatIdAndStatusInForUpdate(
                        invocation.getArgument(1), invocation.getArgument(2)));
        lenient().when(orders.findByUserIdAndChatIdAndStatus(any(), any(), any()))
                .thenAnswer(invocation -> orders.findByChatIdAndStatus(
                        invocation.getArgument(1), invocation.getArgument(2)));
        lenient().when(orders.findTop50ByUserIdAndStatusInOrderByUpdatedAtAsc(any(), any()))
                .thenAnswer(invocation -> orders.findTop50ByStatusInOrderByUpdatedAtAsc(invocation.getArgument(1)));
        lenient().when(orders.findTop100ByUserIdAndChatIdAndStatusOrderByUpdatedAtDesc(any(), any(), any()))
                .thenAnswer(invocation -> orders.findTop100ByChatIdAndStatusOrderByUpdatedAtDesc(
                        invocation.getArgument(1), invocation.getArgument(2)));
        lenient().when(orders.findTop100ByUserIdAndChatIdOrderByUpdatedAtDesc(any(), any()))
                .thenAnswer(invocation -> orders.findTop100ByChatIdOrderByUpdatedAtDesc(invocation.getArgument(1)));
        lenient().when(orders.findTop100ByUserIdAndStatusOrderByUpdatedAtDesc(any(), any()))
                .thenAnswer(invocation -> orders.findTop100ByStatusOrderByUpdatedAtDesc(invocation.getArgument(1)));
        lenient().when(orders.findTop100ByUserIdOrderByUpdatedAtDesc(any()))
                .thenAnswer(invocation -> orders.findTop100ByOrderByUpdatedAtDesc());
    }

    private void stubWaitingPaymentRegistration(Deps deps, String totalPrice) {
        when(deps.conversationRepository.findByChatIdForUpdate("chat-1"))
                .thenReturn(Optional.of(conversation("chat-1", "Q1")));
        when(deps.conversationRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
        when(deps.platformOrderRepository.findByPlatformOrderIdForUpdate("order-1")).thenReturn(Optional.empty());
        when(deps.platformOrderRepository.findByChatIdAndStatusInForUpdate(any(), any())).thenReturn(List.of());
        when(deps.quoteService.getQuote("Q1")).thenReturn(quote("Q1", totalPrice));
    }

    private XianyuWaitingPaymentRequest waitingPaymentRequest(String platformOrderId, String chatId) {
        return new XianyuWaitingPaymentRequest(
                platformOrderId,
                chatId,
                "buyer-1",
                "seller-1",
                "item-1",
                "message-1"
        );
    }

    private XianyuConversation conversation(String chatId, String quoteNo) {
        var conversation = new XianyuConversation();
        conversation.setChatId(chatId);
        conversation.setLatestQuoteNo(quoteNo);
        return conversation;
    }

    private XianyuPlatformOrder waitingOrder(String platformOrderId, String chatId, String quotedAmount) {
        var platformOrder = new XianyuPlatformOrder();
        platformOrder.setPlatformOrderId(platformOrderId);
        platformOrder.setChatId(chatId);
        platformOrder.setBuyerUserId("buyer-1");
        platformOrder.setSellerUserId("seller-1");
        platformOrder.setItemId("item-1");
        platformOrder.setQuoteNo("Q1");
        platformOrder.setQuotedAmount(new BigDecimal(quotedAmount));
        platformOrder.setStatus(XianyuFulfillmentStatus.WAIT_BUYER_PAY);
        return platformOrder;
    }

    private XianyuPlatformOrder adjustedOrder(String platformOrderId, String amount) {
        XianyuPlatformOrder platformOrder = new XianyuPlatformOrder();
        platformOrder.setPlatformOrderId(platformOrderId);
        platformOrder.setTradeNo(platformOrderId);
        platformOrder.setChatId("CHAT_001");
        platformOrder.setBuyerUserId("BUYER_001");
        platformOrder.setItemId("ITEM_001");
        platformOrder.setQuoteNo("Q1");
        platformOrder.setQuotedAmount(new BigDecimal(amount));
        platformOrder.setAdjustedAmount(new BigDecimal(amount));
        platformOrder.setAdjustedAt(LocalDateTime.now());
        platformOrder.setStatus(XianyuFulfillmentStatus.WAIT_BUYER_PAY);
        return platformOrder;
    }

    private XianyuPaidVerificationRequest paidVerificationRequest(
            long paidAmountCents,
            long itemTotalCents,
            long postFeeCents
    ) {
        return new XianyuPaidVerificationRequest(
                paidAmountCents,
                itemTotalCents,
                postFeeCents,
                XianyuAmountVerificationSource.XIANYU_ORDER_DETAIL_PRICE_INFO_AMOUNT
        );
    }

    private void assertCompletedVerificationIsRejected(java.util.function.Consumer<XianyuPlatformOrder> mutation) {
        var deps = newDeps();
        XianyuPlatformOrder platformOrder = completedVerifiedOrder();
        mutation.accept(platformOrder);
        when(deps.platformOrderRepository.findByPlatformOrderIdForUpdate("ORDER_001"))
                .thenReturn(Optional.of(platformOrder));

        assertThatThrownBy(() -> deps.service.verifyPaid("ORDER_001", paidVerificationRequest(8800L, 8800L, 0L)))
                .isInstanceOf(BusinessException.class);

        verify(deps.platformOrderRepository, never()).save(any());
        verify(deps.orderService, never()).createOrder(any());
    }

    private void assertInvalidLocalOrderResponseIsRejected(OrderResponse localOrderResponse) {
        var deps = newDeps();
        XianyuPlatformOrder platformOrder = adjustedOrder("ORDER_001", "88.00");
        when(deps.platformOrderRepository.findByPlatformOrderIdForUpdate("ORDER_001"))
                .thenReturn(Optional.of(platformOrder));
        when(deps.orderService.createOrder(any())).thenReturn(localOrderResponse);

        assertThatThrownBy(() -> deps.service.verifyPaid("ORDER_001", paidVerificationRequest(8800L, 8800L, 0L)))
                .isInstanceOf(BusinessException.class);

        verify(deps.platformOrderRepository, never()).save(any());
        assertThat(platformOrder.getLocalOrderNo()).isNull();
        assertThat(platformOrder.getStatus()).isEqualTo(XianyuFulfillmentStatus.WAIT_BUYER_PAY);
    }

    private XianyuPlatformOrder completedVerifiedOrder() {
        XianyuPlatformOrder platformOrder = adjustedOrder("ORDER_001", "88.00");
        platformOrder.setPaidAmount(new BigDecimal("88.00"));
        platformOrder.setPaidAt(LocalDateTime.of(2026, 7, 30, 10, 0));
        platformOrder.setAmountVerificationSource(XianyuAmountVerificationSource.XIANYU_ORDER_DETAIL_PRICE_INFO_AMOUNT);
        platformOrder.setAmountVerifiedAt(LocalDateTime.of(2026, 7, 30, 10, 0));
        platformOrder.setLocalOrderNo("O1");
        platformOrder.setStatus(XianyuFulfillmentStatus.PAID_WAIT_SUBMIT);
        return platformOrder;
    }

    private QuoteResponse quote(String quoteNo, String totalPrice) {
        return new QuoteResponse(
                quoteNo,
                new MovieTicketInfo(
                        "task",
                        "province",
                        "city",
                        "area",
                        "code",
                        "cinema-id",
                        "cinema-code",
                        "address",
                        "film-id",
                        "film.jpg",
                        1,
                        "show-id",
                        "movie",
                        "cinema",
                        LocalDateTime.now().plusDays(1),
                        "hall",
                        "2D",
                        1,
                        List.of("1排1座"),
                        Map.of("1排1座", totalPrice),
                        totalPrice,
                        totalPrice,
                        "image.jpg"
                ),
                new BigDecimal("66.00"),
                new BigDecimal(totalPrice),
                new BigDecimal(totalPrice),
                new BigDecimal("1.00"),
                "CREATED"
        );
    }

    private XianyuPlatformOrder existingPaidOrder() {
        var platformOrder = new XianyuPlatformOrder();
        platformOrder.setPlatformOrderId("trade-1");
        platformOrder.setTradeNo("trade-1");
        platformOrder.setChatId("chat-1");
        platformOrder.setBuyerUserId("buyer-1");
        platformOrder.setSellerUserId("seller-1");
        platformOrder.setItemId("item-1");
        platformOrder.setQuoteNo("Q1");
        platformOrder.setLocalOrderNo("O1");
        platformOrder.setPaidAmount(new BigDecimal("88.00"));
        platformOrder.setQuotedAmount(new BigDecimal("88.00"));
        platformOrder.setStatus(XianyuFulfillmentStatus.PAID_WAIT_SUBMIT);
        return platformOrder;
    }

    private OrderResponse order(String orderNo, String quoteNo, String status, boolean shouldPoll) {
        return new OrderResponse(
                orderNo,
                quoteNo,
                "XY-buyer-1",
                new BigDecimal("88.00"),
                new BigDecimal("88.00"),
                "upstream-id",
                "upstream-no",
                6,
                "取票码: 123456",
                1,
                null,
                null,
                status,
                status,
                "ISSUED".equals(status) || "REFUNDED".equals(status),
                shouldPoll
        );
    }

    private record Deps(
            XianyuService service,
            XianyuConversationRepository conversationRepository,
            XianyuMessageRepository messageRepository,
            XianyuPlatformOrderRepository platformOrderRepository,
            XianyuDeliveryRecordRepository deliveryRecordRepository,
            OrderService orderService,
            QuoteService quoteService
    ) {
    }
}
