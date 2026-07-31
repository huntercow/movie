package com.movie.ticket.service;

import com.movie.ticket.config.XianyuProperties;
import com.movie.ticket.dto.CreateOrderRequest;
import com.movie.ticket.dto.MovieTicketInfo;
import com.movie.ticket.dto.OrderResponse;
import com.movie.ticket.dto.QuoteResponse;
import com.movie.ticket.dto.XianyuDeliveryResultRequest;
import com.movie.ticket.dto.XianyuAdjustedOrderRequest;
import com.movie.ticket.dto.XianyuImageMessageRequest;
import com.movie.ticket.dto.XianyuPaidVerificationRequest;
import com.movie.ticket.dto.XianyuWaitingPaymentRequest;
import com.movie.ticket.entity.OrderStatus;
import com.movie.ticket.entity.SalesChannel;
import com.movie.ticket.entity.XianyuAmountVerificationSource;
import com.movie.ticket.entity.XianyuConversation;
import com.movie.ticket.entity.XianyuDeliveryRecord;
import com.movie.ticket.entity.XianyuFulfillmentStatus;
import com.movie.ticket.entity.XianyuMessage;
import com.movie.ticket.entity.XianyuPlatformOrder;
import com.movie.ticket.repository.XianyuBuyerRepository;
import com.movie.ticket.repository.XianyuConversationRepository;
import com.movie.ticket.repository.XianyuDeliveryRecordRepository;
import com.movie.ticket.repository.XianyuMessageRepository;
import com.movie.ticket.repository.XianyuPlatformOrderRepository;
import com.movie.ticket.security.UserScopeContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.Collection;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class XianyuMvpFlowSimulationTest {

    @BeforeEach
    void setUserScope() {
        UserScopeContext.set(1L);
    }

    @AfterEach
    void clearUserScope() {
        UserScopeContext.clear();
    }

    @Test
    void dryRunFullXianyuFulfillmentFlowWithoutRealPlatforms() {
        Sim sim = newSim(true);

        var quoteResult = sim.service.createQuoteFromImage(new XianyuImageMessageRequest(
                "chat-1",
                "msg-image-1",
                "buyer-1",
                "buyer",
                "seller-1",
                "item-1",
                "https://example.test/seat.jpg",
                "data:image/jpeg;base64,AAAA",
                "{\"type\":\"image\"}"
        ));

        assertThat(quoteResult.quoteNo()).isEqualTo("Q-SIM");
        assertThat(quoteResult.quote().totalPrice()).isEqualByComparingTo("88.00");
        assertThat(sim.conversations.get("chat-1").getLatestQuoteNo()).isEqualTo("Q-SIM");

        sim.service.registerWaitingPayment(new XianyuWaitingPaymentRequest(
                "trade-1",
                "chat-1",
                "buyer-1",
                "seller-1",
                "item-1",
                "msg-payment-1"
        ));
        sim.service.recordAdjusted("trade-1", new XianyuAdjustedOrderRequest(8800L));
        var paidRequest = paidVerificationRequest();
        var paid = sim.service.verifyPaid("trade-1", paidRequest);

        assertThat(paid.status()).isEqualTo(XianyuFulfillmentStatus.PAID_WAIT_SUBMIT);
        assertThat(paid.localOrderNo()).isEqualTo("O-SIM");
        verify(sim.orderService, times(1)).createOrder(any(CreateOrderRequest.class));

        var duplicatePaid = sim.service.verifyPaid("trade-1", paidRequest);

        assertThat(duplicatePaid.localOrderNo()).isEqualTo("O-SIM");
        verify(sim.orderService, times(1)).createOrder(any(CreateOrderRequest.class));

        sim.localOrderStatus.set(OrderStatus.ISSUED);
        var issued = sim.service.getOrder("trade-1");

        assertThat(issued.status()).isEqualTo(XianyuFulfillmentStatus.ISSUED_WAIT_DELIVER);
        assertThat(issued.shouldDeliver()).isTrue();
        assertThat(issued.deliveryMessage()).contains("出票成功").contains("取票码");

        var attempt = sim.service.claimDelivery("trade-1");
        var delivered = sim.service.recordDelivery("trade-1", new XianyuDeliveryResultRequest(
                attempt.deliveryAttemptId(),
                true,
                "dry-run",
                ""
        ));

        assertThat(delivered.status()).isEqualTo(XianyuFulfillmentStatus.DELIVERED);
        assertThat(delivered.shouldPoll()).isFalse();
        assertThat(sim.deliveryRecords).hasSize(1);
        assertThat(sim.platformOrders.get("trade-1").getDeliveredAt()).isNotNull();
    }

    @Test
    void dryRunPaidOrderStopsBeforeUpstreamWhenAutoFulfillmentDisabled() {
        Sim sim = newSim(false);
        XianyuConversation conversation = new XianyuConversation();
        conversation.setChatId("chat-1");
        conversation.setLatestQuoteNo("Q-SIM");
        sim.conversations.put("chat-1", conversation);
        sim.service.registerWaitingPayment(new XianyuWaitingPaymentRequest(
                "trade-1",
                "chat-1",
                "buyer-1",
                "seller-1",
                "item-1",
                "msg-payment-1"
        ));
        sim.service.recordAdjusted("trade-1", new XianyuAdjustedOrderRequest(8800L));
        var paid = sim.service.verifyPaid("trade-1", paidVerificationRequest());

        assertThat(paid.status()).isEqualTo(XianyuFulfillmentStatus.NEED_MANUAL);
        assertThat(paid.lastError()).contains("auto fulfillment is disabled");
        verify(sim.orderService, never()).createOrder(any(CreateOrderRequest.class));
    }

    private Sim newSim(boolean autoFulfillmentEnabled) {
        Map<String, XianyuConversation> conversations = new LinkedHashMap<>();
        Map<String, XianyuMessage> messages = new LinkedHashMap<>();
        Map<String, XianyuPlatformOrder> platformOrders = new LinkedHashMap<>();
        List<XianyuDeliveryRecord> deliveryRecords = new java.util.ArrayList<>();
        AtomicReference<OrderStatus> localOrderStatus = new AtomicReference<>(OrderStatus.PAID);

        XianyuBuyerRepository buyerRepository = mock(XianyuBuyerRepository.class);
        XianyuConversationRepository conversationRepository = mock(XianyuConversationRepository.class);
        XianyuMessageRepository messageRepository = mock(XianyuMessageRepository.class);
        XianyuPlatformOrderRepository platformOrderRepository = mock(XianyuPlatformOrderRepository.class);
        XianyuDeliveryRecordRepository deliveryRecordRepository = mock(XianyuDeliveryRecordRepository.class);
        QuoteService quoteService = mock(QuoteService.class);
        OrderService orderService = mock(OrderService.class);

        when(buyerRepository.findByUserIdAndBuyerUserId(any(), any())).thenReturn(Optional.empty());
        when(buyerRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
        when(conversationRepository.findByUserIdAndChatIdForUpdate(any(), any())).thenAnswer(invocation ->
                Optional.ofNullable(conversations.get(invocation.getArgument(1))));
        when(conversationRepository.save(any())).thenAnswer(invocation -> {
            XianyuConversation conversation = invocation.getArgument(0);
            conversations.put(conversation.getChatId(), conversation);
            return conversation;
        });
        when(messageRepository.findByUserIdAndChatIdAndMessageId(any(), any(), any())).thenAnswer(invocation ->
                Optional.ofNullable(messages.get(messageKey(invocation.getArgument(1), invocation.getArgument(2)))));
        when(messageRepository.save(any())).thenAnswer(invocation -> {
            XianyuMessage message = invocation.getArgument(0);
            messages.put(messageKey(message.getChatId(), message.getMessageId()), message);
            return message;
        });
        when(platformOrderRepository.findByUserIdAndPlatformOrderId(any(), any())).thenAnswer(invocation ->
                Optional.ofNullable(platformOrders.get(invocation.getArgument(1))));
        when(platformOrderRepository.findByUserIdAndPlatformOrderIdForUpdate(any(), any())).thenAnswer(invocation ->
                Optional.ofNullable(platformOrders.get(invocation.getArgument(1))));
        when(platformOrderRepository.save(any())).thenAnswer(invocation -> {
            XianyuPlatformOrder order = invocation.getArgument(0);
            platformOrders.put(order.getPlatformOrderId(), order);
            return order;
        });
        when(platformOrderRepository.findByUserIdAndChatIdAndStatusInForUpdate(any(), any(), any())).thenAnswer(invocation -> {
            String chatId = invocation.getArgument(1);
            Collection<XianyuFulfillmentStatus> statuses = invocation.getArgument(2);
            return platformOrders.values().stream()
                    .filter(order -> chatId.equals(order.getChatId()) && statuses.contains(order.getStatus()))
                    .sorted(Comparator.comparing(order -> Optional.ofNullable(order.getDeliveredAt()).orElse(LocalDateTime.MIN)))
                    .toList();
        });
        when(deliveryRecordRepository.save(any())).thenAnswer(invocation -> {
            XianyuDeliveryRecord record = invocation.getArgument(0);
            deliveryRecords.add(record);
            return record;
        });

        QuoteResponse quote = quote("Q-SIM", "88.00");
        when(quoteService.createQuote(any())).thenReturn(quote);
        when(quoteService.getQuote("Q-SIM")).thenReturn(quote);
        when(orderService.createOrder(any())).thenReturn(order("O-SIM", "Q-SIM", localOrderStatus.get()));
        when(orderService.getOrder(eq("O-SIM"))).thenAnswer(invocation -> order("O-SIM", "Q-SIM", localOrderStatus.get()));

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
        return new Sim(service, orderService, conversations, platformOrders, deliveryRecords, localOrderStatus);
    }

    private String messageKey(String chatId, String messageId) {
        return chatId + ":" + messageId;
    }

    private XianyuPaidVerificationRequest paidVerificationRequest() {
        return new XianyuPaidVerificationRequest(
                8800L,
                8800L,
                0L,
                XianyuAmountVerificationSource.XIANYU_ORDER_DETAIL_PRICE_INFO_AMOUNT
        );
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
                new BigDecimal("22.00"),
                SalesChannel.GOOFISH.name()
        );
    }

    private OrderResponse order(String orderNo, String quoteNo, OrderStatus status) {
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
                status.name(),
                status.name(),
                status == OrderStatus.ISSUED || status == OrderStatus.REFUNDED,
                status == OrderStatus.PAID || status == OrderStatus.TICKETING
        );
    }

    private record Sim(
            XianyuService service,
            OrderService orderService,
            Map<String, XianyuConversation> conversations,
            Map<String, XianyuPlatformOrder> platformOrders,
            List<XianyuDeliveryRecord> deliveryRecords,
            AtomicReference<OrderStatus> localOrderStatus
    ) {
    }
}
