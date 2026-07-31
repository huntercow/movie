package com.movie.ticket.service;

import com.movie.ticket.config.XianyuProperties;
import com.movie.ticket.dto.CreateOrderRequest;
import com.movie.ticket.dto.CreateQuoteRequest;
import com.movie.ticket.dto.OrderResponse;
import com.movie.ticket.dto.QuoteResponse;
import com.movie.ticket.dto.XianyuAdjustedOrderRequest;
import com.movie.ticket.dto.XianyuDeliveryResultRequest;
import com.movie.ticket.dto.XianyuEventRequest;
import com.movie.ticket.dto.XianyuEventResponse;
import com.movie.ticket.dto.XianyuImageMessageRequest;
import com.movie.ticket.dto.XianyuLatestQuoteResponse;
import com.movie.ticket.dto.XianyuManualOrderRequest;
import com.movie.ticket.dto.XianyuOrderResponse;
import com.movie.ticket.dto.XianyuPaidVerificationRequest;
import com.movie.ticket.dto.XianyuQuoteResult;
import com.movie.ticket.dto.XianyuVerificationFailureRequest;
import com.movie.ticket.dto.XianyuWaitingPaymentRequest;
import com.movie.ticket.dto.XianyuWaitingPaymentResponse;
import com.movie.ticket.entity.OrderStatus;
import com.movie.ticket.entity.SalesChannel;
import com.movie.ticket.entity.XianyuBuyer;
import com.movie.ticket.entity.XianyuAmountVerificationSource;
import com.movie.ticket.entity.XianyuConversation;
import com.movie.ticket.entity.XianyuDeliveryRecord;
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
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDateTime;
import java.util.EnumSet;
import java.util.List;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;

@Service
public class XianyuService {

    private static final List<XianyuFulfillmentStatus> ACTIVE_ORDER_STATUSES = List.of(
            XianyuFulfillmentStatus.WAIT_BUYER_PAY,
            XianyuFulfillmentStatus.PAID_WAIT_SUBMIT,
            XianyuFulfillmentStatus.TICKETING,
            XianyuFulfillmentStatus.ISSUED_WAIT_DELIVER,
            XianyuFulfillmentStatus.DELIVERY_OUTCOME_PENDING,
            XianyuFulfillmentStatus.NEED_MANUAL
    );
    private static final String DUPLICATE_ORDER_ERROR = "同一会话严禁连下两单，请先完成上一单出票或退款";
    private static final Set<String> DELIVERY_FAILURE_SUMMARIES = Set.of(
            "DELIVERY_TEMPLATE_FAILED",
            "TICKET_CODE_SEND_FAILED",
            "DUMMY_CONSIGN_FAILED"
    );
    private static final EnumSet<XianyuFulfillmentStatus> MANUAL_SETTLE_STATUSES = EnumSet.of(
            XianyuFulfillmentStatus.NEED_MANUAL,
            XianyuFulfillmentStatus.REFUNDED,
            XianyuFulfillmentStatus.CLOSED,
            XianyuFulfillmentStatus.DELIVERED
    );
    private static final EnumSet<XianyuFulfillmentStatus> PRESERVED_PLATFORM_STATUSES = EnumSet.of(
            XianyuFulfillmentStatus.NEED_MANUAL,
            XianyuFulfillmentStatus.DELIVERY_OUTCOME_PENDING,
            XianyuFulfillmentStatus.DELIVERED,
            XianyuFulfillmentStatus.REFUNDED,
            XianyuFulfillmentStatus.CLOSED
    );
    private static final EnumSet<XianyuFulfillmentStatus> COMPLETED_VERIFICATION_STATUSES = EnumSet.of(
            XianyuFulfillmentStatus.PAID_WAIT_SUBMIT,
            XianyuFulfillmentStatus.TICKETING,
            XianyuFulfillmentStatus.ISSUED_WAIT_DELIVER,
            XianyuFulfillmentStatus.DELIVERY_OUTCOME_PENDING,
            XianyuFulfillmentStatus.NEED_MANUAL,
            XianyuFulfillmentStatus.DELIVERED,
            XianyuFulfillmentStatus.REFUNDED,
            XianyuFulfillmentStatus.CLOSED
    );

    private final XianyuBuyerRepository buyerRepository;
    private final XianyuConversationRepository conversationRepository;
    private final XianyuMessageRepository messageRepository;
    private final XianyuPlatformOrderRepository platformOrderRepository;
    private final XianyuDeliveryRecordRepository deliveryRecordRepository;
    private final QuoteService quoteService;
    private final OrderService orderService;
    private final XianyuProperties properties;

    public XianyuService(
            XianyuBuyerRepository buyerRepository,
            XianyuConversationRepository conversationRepository,
            XianyuMessageRepository messageRepository,
            XianyuPlatformOrderRepository platformOrderRepository,
            XianyuDeliveryRecordRepository deliveryRecordRepository,
            QuoteService quoteService,
            OrderService orderService,
            XianyuProperties properties
    ) {
        this.buyerRepository = buyerRepository;
        this.conversationRepository = conversationRepository;
        this.messageRepository = messageRepository;
        this.platformOrderRepository = platformOrderRepository;
        this.deliveryRecordRepository = deliveryRecordRepository;
        this.quoteService = quoteService;
        this.orderService = orderService;
        this.properties = properties;
    }

    @Transactional
    public XianyuQuoteResult createQuoteFromImage(XianyuImageMessageRequest request) {
        upsertBuyer(request.buyerUserId(), request.buyerNickname());
        XianyuConversation conversation = upsertConversation(
                request.chatId(),
                request.sellerUserId(),
                request.buyerUserId(),
                request.itemId()
        );
        XianyuMessage existingMessage = findMessage(request.chatId(), request.messageId())
                .orElse(null);
        if (existingMessage != null && StringUtils.hasText(existingMessage.getQuoteNo())) {
            QuoteResponse quote = quoteService.getQuote(existingMessage.getQuoteNo());
            return new XianyuQuoteResult(
                    request.chatId(),
                    request.messageId(),
                    true,
                    quote.quoteNo(),
                    quote,
                    quoteReply(quote)
            );
        }

        QuoteResponse quote = quoteService.createQuote(new CreateQuoteRequest(
                request.imageBase64(),
                customerId(request.chatId(), request.buyerUserId()),
                SalesChannel.GOOFISH
        ));

        conversation.setLatestQuoteNo(quote.quoteNo());
        conversationRepository.save(conversation);
        if (StringUtils.hasText(request.buyerUserId())) {
            findBuyer(request.buyerUserId()).ifPresent(buyer -> {
                buyer.setLatestQuoteNo(quote.quoteNo());
                buyerRepository.save(buyer);
            });
        }

        XianyuMessage message = new XianyuMessage();
        message.setChatId(request.chatId());
        message.setMessageId(request.messageId());
        message.setSenderUserId(request.buyerUserId());
        message.setMessageType("IMAGE");
        message.setQuoteNo(quote.quoteNo());
        message.setRawPayload(request.rawPayload());
        messageRepository.save(message);

        return new XianyuQuoteResult(
                request.chatId(),
                request.messageId(),
                false,
                quote.quoteNo(),
                quote,
                quoteReply(quote)
        );
    }

    @Transactional
    public XianyuWaitingPaymentResponse registerWaitingPayment(XianyuWaitingPaymentRequest request) {
        XianyuConversation conversation = upsertConversation(
                request.chatId(),
                request.sellerUserId(),
                request.buyerUserId(),
                request.itemId()
        );
        XianyuPlatformOrder existingOrder = findPlatformOrderForUpdate(request.platformOrderId()).orElse(null);
        XianyuPlatformOrder activeOrder = findActiveOrderForChat(request.chatId());
        if (existingOrder != null) {
            if (!request.chatId().equals(existingOrder.getChatId())) {
                throw new BusinessException("xianyu platform order does not belong to chat");
            }
            if (existingOrder.getStatus() != XianyuFulfillmentStatus.WAIT_BUYER_PAY
                    && existingOrder.getStatus() != XianyuFulfillmentStatus.NEED_MANUAL) {
                throw new BusinessException("xianyu platform order is not waiting for buyer payment");
            }
            return toWaitingPaymentResponse(existingOrder);
        }

        String quoteNo = requireLatestQuoteNo(conversation);
        QuoteResponse quote = quoteService.getQuote(quoteNo);
        if (!StringUtils.hasText(quote.quoteNo())) {
            throw new BusinessException("quote response is missing quote number");
        }
        if (!quoteNo.equals(quote.quoteNo())) {
            throw new BusinessException("quote number does not match xianyu conversation latest quote");
        }
        long totalPriceCents = quoteTotalPriceCents(quote);

        XianyuPlatformOrder platformOrder = new XianyuPlatformOrder();
        platformOrder.setPlatformOrderId(request.platformOrderId());
        platformOrder.setChatId(request.chatId());
        platformOrder.setBuyerUserId(request.buyerUserId());
        platformOrder.setSellerUserId(request.sellerUserId());
        platformOrder.setItemId(request.itemId());
        platformOrder.setQuoteNo(quoteNo);
        platformOrder.setQuotedAmount(quote.totalPrice().setScale(2, RoundingMode.UNNECESSARY));

        if (activeOrder != null && !request.platformOrderId().equals(activeOrder.getPlatformOrderId())) {
            platformOrder.setStatus(XianyuFulfillmentStatus.NEED_MANUAL);
            platformOrder.setLastError(DUPLICATE_ORDER_ERROR + "，上一单：" + activeOrder.getPlatformOrderId());
        } else {
            platformOrder.setStatus(XianyuFulfillmentStatus.WAIT_BUYER_PAY);
        }
        platformOrderRepository.save(platformOrder);
        return new XianyuWaitingPaymentResponse(
                platformOrder.getPlatformOrderId(),
                platformOrder.getQuoteNo(),
                totalPriceCents,
                platformOrder.getStatus()
        );
    }

    @Transactional
    public XianyuOrderResponse recordAdjusted(String platformOrderId, XianyuAdjustedOrderRequest request) {
        if (request.adjustedAmountCents() <= 0) {
            throw new BusinessException("adjustedAmountCents must be positive");
        }
        XianyuPlatformOrder platformOrder = requirePlatformOrderForUpdate(platformOrderId);
        if (platformOrder.getStatus() != XianyuFulfillmentStatus.WAIT_BUYER_PAY) {
            throw new BusinessException("xianyu platform order is not waiting for buyer payment");
        }
        if (platformOrder.getQuotedAmount() == null) {
            throw new BusinessException("xianyu platform order is missing quoted amount");
        }

        BigDecimal adjustedAmount = BigDecimal.valueOf(request.adjustedAmountCents(), 2);
        BigDecimal existingAdjustedAmount = platformOrder.getAdjustedAmount();
        LocalDateTime existingAdjustedAt = platformOrder.getAdjustedAt();
        if ((existingAdjustedAmount == null) != (existingAdjustedAt == null)) {
            throw new BusinessException("xianyu platform order adjustment is incomplete");
        }
        if (adjustedAmount.compareTo(platformOrder.getQuotedAmount()) != 0) {
            platformOrder.setStatus(XianyuFulfillmentStatus.NEED_MANUAL);
            platformOrder.setLastError("adjusted amount does not match quote total price");
            return toResponse(platformOrderRepository.save(platformOrder));
        }
        if (existingAdjustedAmount != null) {
            if (existingAdjustedAmount.compareTo(adjustedAmount) != 0) {
                platformOrder.setStatus(XianyuFulfillmentStatus.NEED_MANUAL);
                platformOrder.setLastError("adjusted amount evidence does not match previous adjustment");
                return toResponse(platformOrderRepository.save(platformOrder));
            }
            return toResponse(platformOrder);
        }

        platformOrder.setAdjustedAmount(adjustedAmount);
        platformOrder.setAdjustedAt(LocalDateTime.now());
        platformOrder.setLastError(null);
        return toResponse(platformOrderRepository.save(platformOrder));
    }

    @Transactional(readOnly = true)
    public XianyuOrderResponse resolveWaitingPaymentOrder(String chatId) {
        List<XianyuPlatformOrder> orders = listWaitingPaymentOrders(chatId);
        if (orders.size() > 1) {
            throw new BusinessException("multiple active xianyu orders found for chat");
        }
        if (orders.isEmpty()) {
            throw new BusinessException("waiting payment xianyu order not found for chat");
        }
        XianyuPlatformOrder platformOrder = orders.get(0);
        if (platformOrder.getAdjustedAmount() == null || platformOrder.getAdjustedAt() == null) {
            throw new BusinessException("xianyu platform order adjustment is incomplete");
        }
        return toResponse(platformOrder);
    }

    @Transactional
    public XianyuOrderResponse verifyPaid(String platformOrderId, XianyuPaidVerificationRequest request) {
        validatePaidVerificationRequest(request);
        XianyuPlatformOrder platformOrder = requirePlatformOrderForUpdate(platformOrderId);
        BigDecimal paidAmount = BigDecimal.valueOf(request.paidAmountCents(), 2);
        BigDecimal itemTotal = BigDecimal.valueOf(request.itemTotalCents(), 2);
        BigDecimal postFee = BigDecimal.valueOf(request.postFeeCents(), 2);

        if (StringUtils.hasText(platformOrder.getLocalOrderNo())) {
            requireIdenticalPaidEvidence(platformOrder, request.source(), paidAmount, itemTotal, postFee);
            return toResponse(platformOrder);
        }
        if (platformOrder.getStatus() != XianyuFulfillmentStatus.WAIT_BUYER_PAY) {
            throw new BusinessException("xianyu platform order is not waiting for buyer payment");
        }
        if (platformOrder.getQuotedAmount() == null) {
            throw new BusinessException("xianyu platform order is missing quoted amount");
        }
        if (platformOrder.getAdjustedAmount() == null || platformOrder.getAdjustedAt() == null) {
            return saveManualReview(platformOrder, "xianyu platform order adjustment is missing");
        }
        if (paidAmount.compareTo(itemTotal.add(postFee)) != 0) {
            return saveManualReview(platformOrder, "paid amount does not match item total plus post fee");
        }
        if (postFee.signum() != 0) {
            return saveManualReview(platformOrder, "xianyu platform order post fee must be zero");
        }
        if (platformOrder.getQuotedAmount().compareTo(platformOrder.getAdjustedAmount()) != 0) {
            return saveManualReview(platformOrder, "adjusted amount does not match quoted amount");
        }
        if (platformOrder.getAdjustedAmount().compareTo(paidAmount) != 0) {
            return saveManualReview(platformOrder, "paid amount does not match adjusted amount");
        }

        platformOrder.setPaidAmount(paidAmount);
        platformOrder.setPaidAt(LocalDateTime.now());
        platformOrder.setAmountVerificationSource(request.source());
        platformOrder.setAmountVerifiedAt(LocalDateTime.now());
        if (!properties.isAutoFulfillmentEnabled()) {
            return saveManualReview(platformOrder, "xianyu auto fulfillment is disabled");
        }

        OrderResponse order = orderService.createOrder(new CreateOrderRequest(
                platformOrder.getQuoteNo(),
                customerId(platformOrder.getChatId(), platformOrder.getBuyerUserId()),
                platformOrder.getPlatformOrderId()
        ));
        validateCreatedLocalOrder(platformOrder, order);
        platformOrder.setLocalOrderNo(order.orderNo());
        platformOrder.setStatus(XianyuFulfillmentStatus.PAID_WAIT_SUBMIT);
        platformOrder.setLastError(null);
        platformOrderRepository.save(platformOrder);
        return toResponse(platformOrder, order);
    }

    @Transactional
    public XianyuOrderResponse recordVerificationFailure(
            String platformOrderId,
            XianyuVerificationFailureRequest request
    ) {
        if (request == null || request.code() == null) {
            throw new BusinessException("xianyu verification failure code is required");
        }
        XianyuPlatformOrder platformOrder = requirePlatformOrderForUpdate(platformOrderId);
        if (StringUtils.hasText(platformOrder.getLocalOrderNo())) {
            throw new BusinessException("xianyu platform order already has a local order");
        }
        if (platformOrder.getStatus() != XianyuFulfillmentStatus.WAIT_BUYER_PAY) {
            throw new BusinessException("xianyu platform order is not waiting for buyer payment");
        }
        return saveManualReview(platformOrder, verificationFailureMessage(request.code()));
    }

    @Transactional
    public XianyuOrderResponse getOrder(String platformOrderId) {
        XianyuPlatformOrder platformOrder = requirePlatformOrder(platformOrderId);
        return refreshFromLocalOrder(platformOrder);
    }

    @Transactional(readOnly = true)
    public XianyuLatestQuoteResponse getLatestQuote(String chatId) {
        XianyuConversation conversation = findConversation(chatId)
                .orElseThrow(() -> new BusinessException("xianyu conversation not found"));
        if (!StringUtils.hasText(conversation.getLatestQuoteNo())) {
            throw new BusinessException("latest quote not found for xianyu chat");
        }
        QuoteResponse quote = quoteService.getQuote(conversation.getLatestQuoteNo());
        return new XianyuLatestQuoteResponse(chatId, quote.quoteNo(), quote, quoteReply(quote));
    }

    @Transactional
    public List<XianyuOrderResponse> listOrders(XianyuFulfillmentStatus status, String chatId) {
        List<XianyuPlatformOrder> orders = listPlatformOrders(status, chatId);
        return orders.stream().map(this::toResponse).toList();
    }

    @Transactional
    public XianyuOrderResponse getActiveOrder(String chatId) {
        XianyuPlatformOrder activeOrder = findActiveOrderForChat(chatId);
        return activeOrder == null ? null : toResponse(activeOrder);
    }

    @Transactional
    public XianyuOrderResponse updateManualOrder(String platformOrderId, XianyuManualOrderRequest request) {
        if (!MANUAL_SETTLE_STATUSES.contains(request.status())) {
            throw new BusinessException("manual xianyu status can only be NEED_MANUAL, REFUNDED, CLOSED or DELIVERED");
        }
        XianyuPlatformOrder platformOrder = requirePlatformOrderForUpdate(platformOrderId);
        platformOrder.setStatus(request.status());
        platformOrder.setLastError(request.note());
        if (request.status() == XianyuFulfillmentStatus.DELIVERED && platformOrder.getDeliveredAt() == null) {
            platformOrder.setDeliveredAt(LocalDateTime.now());
        }
        platformOrder.setDeliveryClaimedAt(null);
        return toResponse(platformOrderRepository.save(platformOrder));
    }

    @Transactional
    public List<XianyuOrderResponse> listPendingDeliveries() {
        List<XianyuFulfillmentStatus> statuses = List.of(
                        XianyuFulfillmentStatus.PAID_WAIT_SUBMIT,
                        XianyuFulfillmentStatus.TICKETING,
                        XianyuFulfillmentStatus.ISSUED_WAIT_DELIVER
                );
        long userId = currentUserId();
        return platformOrderRepository.findTop50ByUserIdAndStatusInOrderByUpdatedAtAsc(userId, statuses)
                .stream()
                .map(this::refreshFromLocalOrder)
                .filter(response -> shouldPoll(response.status()))
                .toList();
    }

    @Transactional
    public XianyuOrderResponse claimDelivery(String platformOrderId) {
        XianyuPlatformOrder platformOrder = requirePlatformOrderForUpdate(platformOrderId);
        if (platformOrder.getStatus() == XianyuFulfillmentStatus.DELIVERY_OUTCOME_PENDING) {
            requirePendingAttemptState(platformOrder);
            return withDeliveryPermission(toResponse(platformOrder), null, false);
        }
        if (platformOrder.getStatus() != XianyuFulfillmentStatus.ISSUED_WAIT_DELIVER) {
            throw new BusinessException("xianyu platform order is not ready for delivery");
        }
        requireNoDeliveryAttemptState(platformOrder);
        OrderResponse order = requireDeliveryOrder(platformOrder);
        platformOrder.setDeliveryAttemptId(UUID.randomUUID().toString());
        platformOrder.setDeliveryAttemptStartedAt(LocalDateTime.now());
        platformOrder.setStatus(XianyuFulfillmentStatus.DELIVERY_OUTCOME_PENDING);
        platformOrderRepository.save(platformOrder);
        return withDeliveryPermission(toResponse(platformOrder, null), order, true);
    }

    @Transactional
    public XianyuOrderResponse recordDelivery(String platformOrderId, XianyuDeliveryResultRequest request) {
        validateDeliveryResultRequest(request);
        XianyuPlatformOrder platformOrder = requirePlatformOrderForUpdate(platformOrderId);
        if (!Objects.equals(platformOrder.getDeliveryAttemptId(), request.attemptId())) {
            throw new BusinessException("xianyu delivery attempt id mismatch");
        }
        if (platformOrder.getDeliveryAttemptOutcome() != null) {
            requireIdenticalDeliveryOutcome(platformOrder, request);
            return toResponse(platformOrder);
        }
        requirePendingAttemptState(platformOrder);
        XianyuDeliveryRecord record = new XianyuDeliveryRecord();
        record.setPlatformOrderId(platformOrderId);
        record.setDeliveryAttemptId(request.attemptId());
        record.setLocalOrderNo(platformOrder.getLocalOrderNo());
        record.setSuccess(request.success());
        record.setChannel(request.channel());
        record.setErrorMessage(request.errorMessage());
        deliveryRecordRepository.save(record);

        platformOrder.setDeliveryAttemptOutcome(request.success()
                ? XianyuDeliveryAttemptOutcome.SUCCESS
                : XianyuDeliveryAttemptOutcome.FAILURE);
        platformOrder.setDeliveryAttemptChannel(request.channel());
        platformOrder.setDeliveryAttemptErrorMessage(request.errorMessage());
        platformOrder.setDeliveryOutcomeRecordedAt(LocalDateTime.now());
        if (request.success()) {
            platformOrder.setStatus(XianyuFulfillmentStatus.DELIVERED);
            platformOrder.setDeliveredAt(LocalDateTime.now());
            platformOrder.setLastError(null);
        } else {
            platformOrder.setStatus(XianyuFulfillmentStatus.NEED_MANUAL);
            platformOrder.setLastError(request.errorMessage());
        }
        platformOrderRepository.save(platformOrder);
        return toResponse(platformOrder);
    }

    @Transactional
    public void recordEvent(XianyuEventRequest request) {
        if (!StringUtils.hasText(request.chatId())) {
            throw new BusinessException("chatId is required");
        }
        if (!StringUtils.hasText(request.messageId())) {
            throw new BusinessException("messageId is required");
        }
        findMessage(request.chatId(), request.messageId()).orElseGet(() -> {
            XianyuMessage message = new XianyuMessage();
            message.setChatId(request.chatId());
            message.setMessageId(request.messageId());
            message.setMessageType(request.eventType());
            message.setRawPayload(request.rawPayload());
            return messageRepository.save(message);
        });
    }

    @Transactional(readOnly = true)
    public List<XianyuEventResponse> listEvents(String chatId) {
        long userId = currentUserId();
        List<XianyuMessage> messages = StringUtils.hasText(chatId)
                ? messageRepository.findTop100ByUserIdAndChatIdOrderByCreatedAtDesc(userId, chatId)
                : messageRepository.findTop100ByUserIdOrderByCreatedAtDesc(userId);
        return messages.stream().map(this::toEventResponse).toList();
    }

    private XianyuOrderResponse refreshFromLocalOrder(XianyuPlatformOrder platformOrder) {
        if (platformOrder.getStatus() == XianyuFulfillmentStatus.DELIVERY_OUTCOME_PENDING) {
            requirePendingAttemptState(platformOrder);
            return toResponse(platformOrder, null);
        }
        OrderResponse order = null;
        if (StringUtils.hasText(platformOrder.getLocalOrderNo())) {
            order = orderService.getOrder(platformOrder.getLocalOrderNo());
            if (!PRESERVED_PLATFORM_STATUSES.contains(platformOrder.getStatus())) {
                platformOrder.setStatus(mapOrderStatus(order.status()));
                platformOrderRepository.save(platformOrder);
            }
        }
        return toResponse(platformOrder, order);
    }

    private XianyuFulfillmentStatus mapOrderStatus(String status) {
        if (!StringUtils.hasText(status)) {
            throw new BusinessException("local order response is missing status");
        }
        OrderStatus orderStatus = OrderStatus.valueOf(status);
        return switch (orderStatus) {
            case ISSUED -> XianyuFulfillmentStatus.ISSUED_WAIT_DELIVER;
            case REFUNDED -> XianyuFulfillmentStatus.REFUNDED;
            case FAILED, SUBMIT_FAILED -> XianyuFulfillmentStatus.NEED_MANUAL;
            case SUBMITTED, WAIT_PAY, PAID, TICKETING -> XianyuFulfillmentStatus.TICKETING;
            case CREATED, WAIT_SUBMIT, SUBMITTING -> XianyuFulfillmentStatus.PAID_WAIT_SUBMIT;
        };
    }

    private XianyuPlatformOrder findActiveOrderForChat(String chatId) {
        List<XianyuPlatformOrder> orders = listOrdersForChatForUpdate(chatId, ACTIVE_ORDER_STATUSES);
        if (orders.size() > 1) {
            throw new BusinessException("multiple active xianyu orders found for chat");
        }
        return orders.isEmpty() ? null : orders.get(0);
    }

    private void validatePaidVerificationRequest(XianyuPaidVerificationRequest request) {
        if (request == null) {
            throw new BusinessException("xianyu paid verification request is required");
        }
        if (request.paidAmountCents() <= 0) {
            throw new BusinessException("paidAmountCents must be positive");
        }
        if (request.itemTotalCents() <= 0) {
            throw new BusinessException("itemTotalCents must be positive");
        }
        if (request.postFeeCents() == null) {
            throw new BusinessException("postFeeCents is required");
        }
        if (request.postFeeCents() < 0) {
            throw new BusinessException("postFeeCents cannot be negative");
        }
        if (request.source() != XianyuAmountVerificationSource.XIANYU_ORDER_DETAIL_PRICE_INFO_AMOUNT) {
            throw new BusinessException("xianyu amount verification source is invalid");
        }
    }

    private void requireIdenticalPaidEvidence(
            XianyuPlatformOrder platformOrder,
            XianyuAmountVerificationSource source,
            BigDecimal paidAmount,
            BigDecimal itemTotal,
            BigDecimal postFee
    ) {
        if (!COMPLETED_VERIFICATION_STATUSES.contains(platformOrder.getStatus())
                || platformOrder.getAmountVerificationSource() != source
                || platformOrder.getPaidAmount() == null
                || platformOrder.getQuotedAmount() == null
                || platformOrder.getAdjustedAmount() == null
                || platformOrder.getPaidAt() == null
                || platformOrder.getAmountVerifiedAt() == null
                || platformOrder.getAdjustedAt() == null
                || platformOrder.getQuotedAmount().compareTo(platformOrder.getAdjustedAmount()) != 0
                || platformOrder.getAdjustedAmount().compareTo(platformOrder.getPaidAmount()) != 0
                || platformOrder.getPaidAmount().compareTo(paidAmount) != 0
                || itemTotal.compareTo(paidAmount) != 0
                || postFee.signum() != 0) {
            throw new BusinessException("xianyu paid verification evidence conflicts with existing local order");
        }
    }

    private void validateCreatedLocalOrder(XianyuPlatformOrder platformOrder, OrderResponse order) {
        if (order == null) {
            throw new BusinessException("local order creation returned no order");
        }
        if (!StringUtils.hasText(order.orderNo())) {
            throw new BusinessException("local order creation returned no order number");
        }
        if (!StringUtils.hasText(order.quoteNo())) {
            throw new BusinessException("local order creation returned no quote number");
        }
        if (!order.quoteNo().equals(platformOrder.getQuoteNo())) {
            throw new BusinessException("local order quote number does not match xianyu platform order");
        }
    }

    private XianyuOrderResponse saveManualReview(XianyuPlatformOrder platformOrder, String lastError) {
        platformOrder.setStatus(XianyuFulfillmentStatus.NEED_MANUAL);
        platformOrder.setLastError(lastError);
        return toResponse(platformOrderRepository.save(platformOrder));
    }

    private String verificationFailureMessage(XianyuVerificationFailureCode code) {
        return switch (code) {
            case ADJUST_PRICE_REJECTED -> "xianyu adjustment price was rejected";
            case ORDER_DETAIL_REQUEST_FAILED -> "xianyu order detail request failed";
            case ORDER_DETAIL_PROTOCOL_ERROR -> "xianyu order detail protocol error";
            case ORDER_ID_MISMATCH -> "xianyu order id does not match";
            case AMOUNT_MISMATCH -> "xianyu order detail amount does not match";
            case NON_ZERO_POST_FEE -> "xianyu order detail post fee is not zero";
            case MISSING_ADJUSTMENT -> "xianyu platform order adjustment is missing";
        };
    }

    private XianyuPlatformOrder requirePlatformOrder(String platformOrderId) {
        return findPlatformOrder(platformOrderId)
                .orElseThrow(() -> new BusinessException("xianyu platform order not found"));
    }

    private XianyuPlatformOrder requirePlatformOrderForUpdate(String platformOrderId) {
        return findPlatformOrderForUpdate(platformOrderId)
                .orElseThrow(() -> new BusinessException("xianyu platform order not found"));
    }

    private XianyuBuyer upsertBuyer(String buyerUserId, String nickname) {
        if (!StringUtils.hasText(buyerUserId)) {
            return null;
        }
        XianyuBuyer buyer = findBuyer(buyerUserId).orElseGet(() -> {
            XianyuBuyer created = new XianyuBuyer();
            created.setBuyerUserId(buyerUserId);
            return created;
        });
        if (StringUtils.hasText(nickname)) {
            buyer.setNickname(nickname);
        }
        return buyerRepository.save(buyer);
    }

    private XianyuConversation upsertConversation(String chatId, String sellerUserId, String buyerUserId, String itemId) {
        XianyuConversation conversation = findConversationForUpdate(chatId).orElseGet(() -> {
            XianyuConversation created = new XianyuConversation();
            created.setChatId(chatId);
            return created;
        });
        if (StringUtils.hasText(sellerUserId)) {
            conversation.setSellerUserId(sellerUserId);
        }
        if (StringUtils.hasText(buyerUserId)) {
            conversation.setBuyerUserId(buyerUserId);
        }
        if (StringUtils.hasText(itemId)) {
            conversation.setItemId(itemId);
        }
        return conversationRepository.save(conversation);
    }

    private java.util.Optional<XianyuMessage> findMessage(String chatId, String messageId) {
        return messageRepository.findByUserIdAndChatIdAndMessageId(currentUserId(), chatId, messageId);
    }

    private java.util.Optional<XianyuBuyer> findBuyer(String buyerUserId) {
        return buyerRepository.findByUserIdAndBuyerUserId(currentUserId(), buyerUserId);
    }

    private java.util.Optional<XianyuConversation> findConversation(String chatId) {
        return conversationRepository.findByUserIdAndChatId(currentUserId(), chatId);
    }

    private java.util.Optional<XianyuConversation> findConversationForUpdate(String chatId) {
        return conversationRepository.findByUserIdAndChatIdForUpdate(currentUserId(), chatId);
    }

    private java.util.Optional<XianyuPlatformOrder> findPlatformOrder(String platformOrderId) {
        return platformOrderRepository.findByUserIdAndPlatformOrderId(currentUserId(), platformOrderId);
    }

    private java.util.Optional<XianyuPlatformOrder> findPlatformOrderForUpdate(String platformOrderId) {
        return platformOrderRepository.findByUserIdAndPlatformOrderIdForUpdate(currentUserId(), platformOrderId);
    }

    private List<XianyuPlatformOrder> listOrdersForChatForUpdate(
            String chatId,
            java.util.Collection<XianyuFulfillmentStatus> statuses
    ) {
        return platformOrderRepository.findByUserIdAndChatIdAndStatusInForUpdate(currentUserId(), chatId, statuses);
    }

    private List<XianyuPlatformOrder> listWaitingPaymentOrders(String chatId) {
        return platformOrderRepository.findByUserIdAndChatIdAndStatus(
                currentUserId(),
                chatId,
                XianyuFulfillmentStatus.WAIT_BUYER_PAY
        );
    }

    private List<XianyuPlatformOrder> listPlatformOrders(XianyuFulfillmentStatus status, String chatId) {
        long userId = currentUserId();
        if (StringUtils.hasText(chatId) && status != null) {
            return platformOrderRepository.findTop100ByUserIdAndChatIdAndStatusOrderByUpdatedAtDesc(userId, chatId, status);
        }
        if (StringUtils.hasText(chatId)) {
            return platformOrderRepository.findTop100ByUserIdAndChatIdOrderByUpdatedAtDesc(userId, chatId);
        }
        if (status != null) {
            return platformOrderRepository.findTop100ByUserIdAndStatusOrderByUpdatedAtDesc(userId, status);
        }
        return platformOrderRepository.findTop100ByUserIdOrderByUpdatedAtDesc(userId);
    }

    private long currentUserId() {
        Long userId = UserScopeContext.get();
        if (userId == null) {
            throw new BusinessException("current user scope is required for xianyu service");
        }
        return userId;
    }

    private XianyuOrderResponse toResponse(XianyuPlatformOrder platformOrder) {
        if (platformOrder.getStatus() == XianyuFulfillmentStatus.DELIVERY_OUTCOME_PENDING) {
            requirePendingAttemptState(platformOrder);
            return toResponse(platformOrder, null);
        }
        OrderResponse order = null;
        if (StringUtils.hasText(platformOrder.getLocalOrderNo())) {
            order = orderService.getOrder(platformOrder.getLocalOrderNo());
        }
        return toResponse(platformOrder, order);
    }

    private XianyuOrderResponse toResponse(XianyuPlatformOrder platformOrder, OrderResponse order) {
        boolean shouldDeliver = platformOrder.getStatus() == XianyuFulfillmentStatus.ISSUED_WAIT_DELIVER;
        return new XianyuOrderResponse(
                platformOrder.getPlatformOrderId(),
                platformOrder.getTradeNo(),
                platformOrder.getChatId(),
                platformOrder.getBuyerUserId(),
                platformOrder.getItemId(),
                platformOrder.getQuoteNo(),
                platformOrder.getLocalOrderNo(),
                platformOrder.getPaidAmount(),
                platformOrder.getQuotedAmount(),
                platformOrder.getStatus(),
                platformOrder.getLastError(),
                order,
                shouldPoll(platformOrder.getStatus()),
                shouldDeliver,
                shouldDeliver ? deliveryMessage(order) : null,
                order == null ? null : order.ticketCodeInfo(),
                platformOrder.getAdjustedAmount(),
                platformOrder.getAmountVerificationSource(),
                platformOrder.getAdjustedAt(),
                platformOrder.getAmountVerifiedAt(),
                platformOrder.getDeliveryAttemptId(),
                platformOrder.getDeliveryAttemptStartedAt(),
                platformOrder.getDeliveryAttemptOutcome(),
                platformOrder.getDeliveryAttemptChannel(),
                platformOrder.getDeliveryAttemptErrorMessage(),
                platformOrder.getDeliveryOutcomeRecordedAt()
        );
    }

    private XianyuOrderResponse withDeliveryPermission(
            XianyuOrderResponse response,
            OrderResponse deliveryOrder,
            boolean shouldDeliver
    ) {
        boolean granted = shouldDeliver
                && response.status() == XianyuFulfillmentStatus.DELIVERY_OUTCOME_PENDING
                && deliveryOrder != null;
        return new XianyuOrderResponse(
                response.platformOrderId(),
                response.tradeNo(),
                response.chatId(),
                response.buyerUserId(),
                response.itemId(),
                response.quoteNo(),
                response.localOrderNo(),
                response.paidAmount(),
                response.quotedAmount(),
                response.status(),
                response.lastError(),
                granted ? deliveryOrder : null,
                false,
                granted,
                granted ? deliveryMessage(deliveryOrder) : null,
                granted ? deliveryOrder.ticketCodeInfo() : null,
                response.adjustedAmount(),
                response.amountVerificationSource(),
                response.adjustedAt(),
                response.amountVerifiedAt(),
                response.deliveryAttemptId(),
                response.deliveryAttemptStartedAt(),
                response.deliveryAttemptOutcome(),
                response.deliveryAttemptChannel(),
                response.deliveryAttemptErrorMessage(),
                response.deliveryOutcomeRecordedAt()
        );
    }

    private OrderResponse requireDeliveryOrder(XianyuPlatformOrder platformOrder) {
        if (!StringUtils.hasText(platformOrder.getLocalOrderNo())) {
            throw new BusinessException("xianyu platform order is missing local order number");
        }
        OrderResponse order = orderService.getOrder(platformOrder.getLocalOrderNo());
        if (order == null || !StringUtils.hasText(order.ticketCodeInfo())) {
            throw new BusinessException("local order is missing ticket code information");
        }
        return order;
    }

    private void requireNoDeliveryAttemptState(XianyuPlatformOrder platformOrder) {
        if (StringUtils.hasText(platformOrder.getDeliveryAttemptId())
                || platformOrder.getDeliveryAttemptStartedAt() != null
                || platformOrder.getDeliveryAttemptOutcome() != null
                || StringUtils.hasText(platformOrder.getDeliveryAttemptChannel())
                || platformOrder.getDeliveryAttemptErrorMessage() != null
                || platformOrder.getDeliveryOutcomeRecordedAt() != null
                || platformOrder.getDeliveryClaimedAt() != null) {
            throw new BusinessException("xianyu delivery attempt state is inconsistent");
        }
    }

    private void requirePendingAttemptState(XianyuPlatformOrder platformOrder) {
        if (platformOrder.getStatus() != XianyuFulfillmentStatus.DELIVERY_OUTCOME_PENDING
                || !StringUtils.hasText(platformOrder.getDeliveryAttemptId())
                || platformOrder.getDeliveryAttemptStartedAt() == null
                || platformOrder.getDeliveryAttemptOutcome() != null
                || platformOrder.getDeliveryAttemptChannel() != null
                || platformOrder.getDeliveryAttemptErrorMessage() != null
                || platformOrder.getDeliveryOutcomeRecordedAt() != null) {
            throw new BusinessException("xianyu delivery attempt state is inconsistent");
        }
    }

    private void validateDeliveryResultRequest(XianyuDeliveryResultRequest request) {
        if (request == null || !StringUtils.hasText(request.attemptId())) {
            throw new BusinessException("xianyu delivery attempt id is required");
        }
        if (request.success() == null) {
            throw new BusinessException("xianyu delivery outcome is required");
        }
        if (!StringUtils.hasText(request.channel())) {
            throw new BusinessException("xianyu delivery channel is required");
        }
        if (request.success()) {
            if (!"".equals(request.errorMessage())) {
                throw new BusinessException("successful xianyu delivery must use an empty error summary");
            }
        } else if (!DELIVERY_FAILURE_SUMMARIES.contains(request.errorMessage())) {
            throw new BusinessException("xianyu delivery failure summary is invalid");
        }
    }

    private void requireIdenticalDeliveryOutcome(
            XianyuPlatformOrder platformOrder,
            XianyuDeliveryResultRequest request
    ) {
        XianyuDeliveryAttemptOutcome requestedOutcome = request.success()
                ? XianyuDeliveryAttemptOutcome.SUCCESS
                : XianyuDeliveryAttemptOutcome.FAILURE;
        XianyuFulfillmentStatus expectedStatus = request.success()
                ? XianyuFulfillmentStatus.DELIVERED
                : XianyuFulfillmentStatus.NEED_MANUAL;
        if (platformOrder.getDeliveryAttemptStartedAt() == null
                || platformOrder.getDeliveryOutcomeRecordedAt() == null
                || platformOrder.getDeliveryAttemptOutcome() != requestedOutcome
                || platformOrder.getStatus() != expectedStatus
                || !Objects.equals(platformOrder.getDeliveryAttemptChannel(), request.channel())
                || !Objects.equals(platformOrder.getDeliveryAttemptErrorMessage(), request.errorMessage())) {
            throw new BusinessException("xianyu delivery attempt outcome conflict");
        }
    }

    private XianyuWaitingPaymentResponse toWaitingPaymentResponse(XianyuPlatformOrder platformOrder) {
        if (!StringUtils.hasText(platformOrder.getQuoteNo())) {
            throw new BusinessException("xianyu platform order is missing quote number");
        }
        if (platformOrder.getQuotedAmount() == null) {
            throw new BusinessException("xianyu platform order is missing quoted amount");
        }
        long totalPriceCents = platformOrder.getQuotedAmount()
                .setScale(2, RoundingMode.UNNECESSARY)
                .movePointRight(2)
                .longValueExact();
        return new XianyuWaitingPaymentResponse(
                platformOrder.getPlatformOrderId(),
                platformOrder.getQuoteNo(),
                totalPriceCents,
                platformOrder.getStatus()
        );
    }

    private long quoteTotalPriceCents(QuoteResponse quote) {
        if (quote.totalPrice() == null) {
            throw new BusinessException("quote is missing total price");
        }
        return quote.totalPrice()
                .setScale(2, RoundingMode.UNNECESSARY)
                .movePointRight(2)
                .longValueExact();
    }

    private String requireLatestQuoteNo(XianyuConversation conversation) {
        if (!StringUtils.hasText(conversation.getLatestQuoteNo())) {
            throw new BusinessException("latest quote not found for xianyu chat");
        }
        return conversation.getLatestQuoteNo();
    }

    private XianyuEventResponse toEventResponse(XianyuMessage message) {
        return new XianyuEventResponse(
                message.getId(),
                message.getChatId(),
                message.getMessageId(),
                message.getSenderUserId(),
                message.getMessageType(),
                message.getQuoteNo(),
                message.getRawPayload(),
                message.getCreatedAt()
        );
    }

    private boolean shouldPoll(XianyuFulfillmentStatus status) {
        return status == XianyuFulfillmentStatus.PAID_WAIT_SUBMIT
                || status == XianyuFulfillmentStatus.TICKETING
                || status == XianyuFulfillmentStatus.ISSUED_WAIT_DELIVER;
    }

    private String quoteReply(QuoteResponse quote) {
        return "影片: " + requireDisplayText(quote.ticketInfo().movieName(), "movieName")
                + "\n影院: " + requireDisplayText(quote.ticketInfo().cinemaName(), "cinemaName")
                + "\n座位: " + String.join(",", quote.ticketInfo().seats())
                + "\n整单报价: " + quote.totalPrice();
    }

    private String deliveryMessage(OrderResponse order) {
        if (order == null) {
            return null;
        }
        return "出票成功，请凭以下取票信息观影:\n"
                + requireDisplayText(order.ticketCodeInfo(), "ticketCodeInfo");
    }

    private String customerId(String chatId, String buyerUserId) {
        if (StringUtils.hasText(buyerUserId)) {
            return "XY-" + buyerUserId;
        }
        if (!StringUtils.hasText(chatId)) {
            throw new BusinessException("chatId is required when buyerUserId is missing");
        }
        return "XY-" + chatId;
    }

    private String requireDisplayText(String value, String field) {
        if (!StringUtils.hasText(value)) {
            throw new BusinessException("response is missing " + field);
        }
        return value;
    }
}
