package com.movie.ticket.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.movie.ticket.exception.BusinessException;
import com.movie.ticket.config.XianyuProperties;
import com.movie.ticket.dto.XianyuAdjustedOrderRequest;
import com.movie.ticket.dto.XianyuPaidVerificationRequest;
import com.movie.ticket.dto.XianyuDeliveryResultRequest;
import com.movie.ticket.dto.XianyuVerificationFailureRequest;
import com.movie.ticket.dto.XianyuWaitingPaymentRequest;
import com.movie.ticket.entity.XianyuAmountVerificationSource;
import com.movie.ticket.entity.XianyuConversation;
import com.movie.ticket.entity.XianyuFulfillmentStatus;
import com.movie.ticket.entity.XianyuPlatformOrder;
import com.movie.ticket.entity.XianyuVerificationFailureCode;
import com.movie.ticket.repository.XianyuBuyerRepository;
import com.movie.ticket.repository.XianyuConversationRepository;
import com.movie.ticket.repository.XianyuDeliveryRecordRepository;
import com.movie.ticket.repository.XianyuMessageRepository;
import com.movie.ticket.repository.XianyuPlatformOrderRepository;
import com.movie.ticket.repository.TicketQuoteRepository;
import com.movie.ticket.security.UserScopeContext;
import com.movie.ticket.upstream.TicketUpstreamClient;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class UserDataIsolationTest {

    @AfterEach
    void clearContext() {
        UserScopeContext.clear();
    }

    @Test
    void xianyuServiceFailsClosedWithoutUserScopeAndNeverCallsGlobalRepositories() {
        XianyuPlatformOrderRepository orders = mock(XianyuPlatformOrderRepository.class);
        XianyuBuyerRepository buyers = mock(XianyuBuyerRepository.class);
        XianyuConversationRepository conversations = mock(XianyuConversationRepository.class);
        XianyuMessageRepository messages = mock(XianyuMessageRepository.class);
        XianyuDeliveryRecordRepository deliveries = mock(XianyuDeliveryRecordRepository.class);
        XianyuService service = new XianyuService(
                buyers,
                conversations,
                messages,
                orders,
                deliveries,
                mock(QuoteService.class),
                mock(OrderService.class),
                new XianyuProperties(true)
        );

        assertThatThrownBy(service::listPendingDeliveries)
                .isInstanceOf(BusinessException.class)
                .hasMessage("current user scope is required for xianyu service");
        assertThatThrownBy(() -> service.claimDelivery("ORDER_001"))
                .isInstanceOf(BusinessException.class)
                .hasMessage("current user scope is required for xianyu service");
        assertThatThrownBy(() -> service.getOrder("ORDER_001"))
                .isInstanceOf(BusinessException.class)
                .hasMessage("current user scope is required for xianyu service");

        verifyNoInteractions(buyers, conversations, messages, orders, deliveries);
    }

    @Test
    void quoteReadsUseCurrentUserScopeAndDoNotFallBackToGlobalLookup() {
        TicketQuoteRepository quotes = mock(TicketQuoteRepository.class);
        QuoteService service = new QuoteService(mock(TicketUpstreamClient.class), mock(PricingService.class), quotes,
                new ObjectMapper());
        UserScopeContext.set(44L);
        when(quotes.findTop100ByUserIdOrderByCreatedAtDesc(44L)).thenReturn(List.of());
        when(quotes.findByUserIdAndQuoteNo(44L, "other-users-quote")).thenReturn(Optional.empty());

        assertThat(service.listCurrentUserQuotes()).isEmpty();
        assertThatThrownBy(() -> service.getQuote("other-users-quote"))
                .isInstanceOf(BusinessException.class)
                .hasMessage("quote not found");
        verify(quotes).findTop100ByUserIdOrderByCreatedAtDesc(44L);
        verify(quotes).findByUserIdAndQuoteNo(44L, "other-users-quote");
        verify(quotes, never()).findByQuoteNo("other-users-quote");
    }

    @Test
    void waitingPaymentReadsUseCurrentUserScopeAndDoNotFallBackToGlobalLookup() {
        XianyuPlatformOrderRepository orders = mock(XianyuPlatformOrderRepository.class);
        XianyuService service = new XianyuService(
                mock(XianyuBuyerRepository.class),
                mock(XianyuConversationRepository.class),
                mock(XianyuMessageRepository.class),
                orders,
                mock(XianyuDeliveryRecordRepository.class),
                mock(QuoteService.class),
                mock(OrderService.class),
                new XianyuProperties(true)
        );
        UserScopeContext.set(44L);
        when(orders.findByUserIdAndChatIdAndStatus(44L, "other-users-chat", XianyuFulfillmentStatus.WAIT_BUYER_PAY))
                .thenReturn(List.of());

        assertThatThrownBy(() -> service.resolveWaitingPaymentOrder("other-users-chat"))
                .isInstanceOf(BusinessException.class);
        verify(orders).findByUserIdAndChatIdAndStatus(
                44L,
                "other-users-chat",
                XianyuFulfillmentStatus.WAIT_BUYER_PAY
        );
        verify(orders, never()).findByChatIdAndStatus(
                "other-users-chat",
                XianyuFulfillmentStatus.WAIT_BUYER_PAY
        );
    }

    @Test
    void waitingPaymentRegistrationUsesOnlyCurrentUserScopedLocks() {
        XianyuConversationRepository conversations = mock(XianyuConversationRepository.class);
        XianyuPlatformOrderRepository orders = mock(XianyuPlatformOrderRepository.class);
        XianyuService service = new XianyuService(
                mock(XianyuBuyerRepository.class),
                conversations,
                mock(XianyuMessageRepository.class),
                orders,
                mock(XianyuDeliveryRecordRepository.class),
                mock(QuoteService.class),
                mock(OrderService.class),
                new XianyuProperties(true)
        );
        UserScopeContext.set(44L);
        XianyuConversation conversation = new XianyuConversation();
        conversation.setChatId("other-users-chat");
        XianyuPlatformOrder existingOrder = new XianyuPlatformOrder();
        existingOrder.setPlatformOrderId("other-users-order");
        existingOrder.setChatId("other-users-chat");
        existingOrder.setQuoteNo("Q1");
        existingOrder.setQuotedAmount(new BigDecimal("88.00"));
        existingOrder.setStatus(XianyuFulfillmentStatus.WAIT_BUYER_PAY);
        when(conversations.findByUserIdAndChatIdForUpdate(44L, "other-users-chat"))
                .thenReturn(Optional.of(conversation));
        when(conversations.save(conversation)).thenReturn(conversation);
        when(orders.findByUserIdAndPlatformOrderIdForUpdate(44L, "other-users-order"))
                .thenReturn(Optional.of(existingOrder));
        when(orders.findByUserIdAndChatIdAndStatusInForUpdate(
                org.mockito.ArgumentMatchers.eq(44L),
                org.mockito.ArgumentMatchers.eq("other-users-chat"),
                org.mockito.ArgumentMatchers.anyCollection()
        )).thenReturn(List.of(existingOrder));

        service.registerWaitingPayment(new XianyuWaitingPaymentRequest(
                "other-users-order",
                "other-users-chat",
                "other-users-buyer",
                "other-users-seller",
                "other-users-item",
                "other-users-message"
        ));

        verify(conversations).findByUserIdAndChatIdForUpdate(44L, "other-users-chat");
        verify(orders).findByUserIdAndPlatformOrderIdForUpdate(44L, "other-users-order");
        verify(conversations, never()).findByChatIdForUpdate("other-users-chat");
        verify(orders, never()).findByPlatformOrderIdForUpdate("other-users-order");
        verify(orders, never()).findByChatIdAndStatusInForUpdate(
                org.mockito.ArgumentMatchers.eq("other-users-chat"),
                org.mockito.ArgumentMatchers.anyCollection()
        );
    }

    @Test
    void adjustedOrderUsesCurrentUserScopedLockAndDoesNotFallBackToGlobalLookup() {
        XianyuPlatformOrderRepository orders = mock(XianyuPlatformOrderRepository.class);
        XianyuService service = new XianyuService(
                mock(XianyuBuyerRepository.class),
                mock(XianyuConversationRepository.class),
                mock(XianyuMessageRepository.class),
                orders,
                mock(XianyuDeliveryRecordRepository.class),
                mock(QuoteService.class),
                mock(OrderService.class),
                new XianyuProperties(true)
        );
        UserScopeContext.set(44L);
        when(orders.findByUserIdAndPlatformOrderIdForUpdate(44L, "other-users-order"))
                .thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.recordAdjusted(
                "other-users-order",
                new XianyuAdjustedOrderRequest(8800L)
        ))
                .isInstanceOf(BusinessException.class)
                .hasMessage("xianyu platform order not found");
        verify(orders).findByUserIdAndPlatformOrderIdForUpdate(44L, "other-users-order");
        verify(orders, never()).findByPlatformOrderIdForUpdate("other-users-order");
    }

    @Test
    void paidVerificationUsesCurrentUserScopedLockAndDoesNotFallBackToGlobalLookup() {
        XianyuPlatformOrderRepository orders = mock(XianyuPlatformOrderRepository.class);
        XianyuService service = new XianyuService(
                mock(XianyuBuyerRepository.class),
                mock(XianyuConversationRepository.class),
                mock(XianyuMessageRepository.class),
                orders,
                mock(XianyuDeliveryRecordRepository.class),
                mock(QuoteService.class),
                mock(OrderService.class),
                new XianyuProperties(true)
        );
        UserScopeContext.set(44L);
        when(orders.findByUserIdAndPlatformOrderIdForUpdate(44L, "other-users-order"))
                .thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.verifyPaid("other-users-order", new XianyuPaidVerificationRequest(
                8800L,
                8800L,
                0L,
                XianyuAmountVerificationSource.XIANYU_ORDER_DETAIL_PRICE_INFO_AMOUNT
        )))
                .isInstanceOf(BusinessException.class)
                .hasMessage("xianyu platform order not found");
        verify(orders).findByUserIdAndPlatformOrderIdForUpdate(44L, "other-users-order");
        verify(orders, never()).findByPlatformOrderIdForUpdate("other-users-order");
    }

    @Test
    void verificationFailureUsesCurrentUserScopedLockAndDoesNotFallBackToGlobalLookup() {
        XianyuPlatformOrderRepository orders = mock(XianyuPlatformOrderRepository.class);
        XianyuService service = new XianyuService(
                mock(XianyuBuyerRepository.class),
                mock(XianyuConversationRepository.class),
                mock(XianyuMessageRepository.class),
                orders,
                mock(XianyuDeliveryRecordRepository.class),
                mock(QuoteService.class),
                mock(OrderService.class),
                new XianyuProperties(true)
        );
        UserScopeContext.set(44L);
        when(orders.findByUserIdAndPlatformOrderIdForUpdate(44L, "other-users-order"))
                .thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.recordVerificationFailure("other-users-order", new XianyuVerificationFailureRequest(
                XianyuVerificationFailureCode.AMOUNT_MISMATCH
        )))
                .isInstanceOf(BusinessException.class)
                .hasMessage("xianyu platform order not found");
        verify(orders).findByUserIdAndPlatformOrderIdForUpdate(44L, "other-users-order");
        verify(orders, never()).findByPlatformOrderIdForUpdate("other-users-order");
    }

    @Test
    void deliveryAttemptAndResultUseCurrentUserScopedLockWithoutGlobalFallback() {
        XianyuPlatformOrderRepository orders = mock(XianyuPlatformOrderRepository.class);
        XianyuService service = new XianyuService(
                mock(XianyuBuyerRepository.class),
                mock(XianyuConversationRepository.class),
                mock(XianyuMessageRepository.class),
                orders,
                mock(XianyuDeliveryRecordRepository.class),
                mock(QuoteService.class),
                mock(OrderService.class),
                new XianyuProperties(true)
        );
        UserScopeContext.set(44L);
        when(orders.findByUserIdAndPlatformOrderIdForUpdate(44L, "other-users-order"))
                .thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.claimDelivery("other-users-order"))
                .isInstanceOf(BusinessException.class)
                .hasMessage("xianyu platform order not found");
        assertThatThrownBy(() -> service.recordDelivery("other-users-order", new XianyuDeliveryResultRequest(
                "ATTEMPT_001", true, "xianyu-mtop", ""
        )))
                .isInstanceOf(BusinessException.class)
                .hasMessage("xianyu platform order not found");
        verify(orders, times(2)).findByUserIdAndPlatformOrderIdForUpdate(44L, "other-users-order");
        verify(orders, never()).findByPlatformOrderIdForUpdate("other-users-order");
    }

    @Test
    void xianyuOrderReadCannotEscapeCurrentUserScope() {
        XianyuPlatformOrderRepository orders = mock(XianyuPlatformOrderRepository.class);
        XianyuService service = new XianyuService(
                mock(XianyuBuyerRepository.class),
                mock(XianyuConversationRepository.class),
                mock(XianyuMessageRepository.class),
                orders,
                mock(XianyuDeliveryRecordRepository.class),
                mock(QuoteService.class),
                mock(OrderService.class),
                new XianyuProperties(true)
        );
        UserScopeContext.set(44L);
        when(orders.findByUserIdAndPlatformOrderId(44L, "other-users-order")).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.getOrder("other-users-order"))
                .isInstanceOf(BusinessException.class)
                .hasMessage("xianyu platform order not found");
        verify(orders).findByUserIdAndPlatformOrderId(44L, "other-users-order");
        verify(orders, never()).findByPlatformOrderId("other-users-order");
    }
}
