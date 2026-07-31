package com.movie.ticket.service;

import com.movie.ticket.dto.BotCreateOrderRequest;
import com.movie.ticket.dto.BotImageQuoteRequest;
import com.movie.ticket.dto.BotPaymentConfirmRequest;
import com.movie.ticket.dto.BotPaymentResponse;
import com.movie.ticket.dto.BotQuoteResponse;
import com.movie.ticket.dto.CreateOrderRequest;
import com.movie.ticket.dto.CreateQuoteRequest;
import com.movie.ticket.dto.OrderResponse;
import com.movie.ticket.entity.BotMessage;
import com.movie.ticket.entity.Customer;
import com.movie.ticket.entity.PaymentRecord;
import com.movie.ticket.entity.PaymentStatus;
import com.movie.ticket.entity.SalesChannel;
import com.movie.ticket.entity.TicketQuote;
import com.movie.ticket.exception.BusinessException;
import com.movie.ticket.repository.BotMessageRepository;
import com.movie.ticket.repository.CustomerRepository;
import com.movie.ticket.repository.PaymentRecordRepository;
import com.movie.ticket.security.UserScopeContext;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.UUID;

@Service
public class BotService {

    private final CustomerRepository customerRepository;
    private final BotMessageRepository botMessageRepository;
    private final PaymentRecordRepository paymentRecordRepository;
    private final QuoteService quoteService;
    private final OrderService orderService;

    public BotService(
            CustomerRepository customerRepository,
            BotMessageRepository botMessageRepository,
            PaymentRecordRepository paymentRecordRepository,
            QuoteService quoteService,
            OrderService orderService
    ) {
        this.customerRepository = customerRepository;
        this.botMessageRepository = botMessageRepository;
        this.paymentRecordRepository = paymentRecordRepository;
        this.quoteService = quoteService;
        this.orderService = orderService;
    }

    /**
     * Handles a private chat image message and creates a quote bound to the customer.
     */
    @Transactional
    public BotQuoteResponse createQuoteFromImage(BotImageQuoteRequest request) {
        Customer customer = upsertCustomer(request.wechatId(), request.nickname(), request.avatarUrl());
        BotMessage existingMessage = findBotMessage(request.wechatId(), request.messageId())
                .orElse(null);
        if (existingMessage != null) {
            return toBotQuoteResponse(customer, request.messageId(), true, quoteService.getQuote(existingMessage.getQuoteNo()));
        }

        var quote = quoteService.createQuote(new CreateQuoteRequest(
                request.imageBase64(),
                customer.getCustomerNo(),
                SalesChannel.WECHAT
        ));
        customer.setLatestQuoteNo(quote.quoteNo());
        customerRepository.save(customer);

        BotMessage botMessage = new BotMessage();
        botMessage.setWechatId(request.wechatId());
        botMessage.setMessageId(request.messageId());
        botMessage.setCustomerNo(customer.getCustomerNo());
        botMessage.setQuoteNo(quote.quoteNo());
        botMessageRepository.save(botMessage);

        return toBotQuoteResponse(customer, request.messageId(), false, quote);
    }

    private BotQuoteResponse toBotQuoteResponse(Customer customer, String messageId, boolean duplicated, com.movie.ticket.dto.QuoteResponse quote) {
        return new BotQuoteResponse(
                customer.getCustomerNo(),
                messageId,
                duplicated,
                quote.quoteNo().equals(customer.getLatestQuoteNo()),
                customer.getLatestQuoteNo(),
                quote
        );
    }

    /**
     * Stores a confirmed transfer record that can later be consumed by order creation.
     */
    @Transactional
    public BotPaymentResponse confirmPayment(BotPaymentConfirmRequest request) {
        Customer customer = requireCustomer(request.wechatId());
        TicketQuote quote = quoteService.requireQuote(request.quoteNo());
        ensureQuoteBelongsToCustomer(quote, customer);
        ensureLatestQuote(quote, customer);

        if (StringUtils.hasText(request.paymentNo())) {
            PaymentRecord existingPayment = findPaymentByExternalNo(request.paymentNo()).orElse(null);
            if (existingPayment != null) {
                if (!customer.getCustomerNo().equals(existingPayment.getCustomerNo())
                        || !quote.getQuoteNo().equals(existingPayment.getQuoteNo())
                        || existingPayment.getAmount().compareTo(request.amount()) != 0) {
                    throw new BusinessException("payment number already belongs to another payment confirmation");
                }
                return toPaymentResponse(existingPayment);
            }
        }

        PaymentRecord paymentRecord = new PaymentRecord();
        paymentRecord.setPaymentRecordNo(newPaymentRecordNo());
        paymentRecord.setCustomerNo(customer.getCustomerNo());
        paymentRecord.setQuoteNo(quote.getQuoteNo());
        paymentRecord.setPaymentNo(request.paymentNo());
        paymentRecord.setAmount(request.amount());
        paymentRecord.setProofImageUrl(request.proofImageUrl());
        paymentRecord.setConfirmer(request.confirmer());
        paymentRecord.setRemark(request.remark());
        paymentRecord.setConfirmedAt(LocalDateTime.now());
        paymentRecord.setStatus(PaymentStatus.CONFIRMED);
        paymentRecordRepository.save(paymentRecord);
        return toPaymentResponse(paymentRecord);
    }

    /**
     * Creates an order only after a confirmed payment record is found and the amount is enough.
     */
    @Transactional
    public OrderResponse createOrderAfterPayment(BotCreateOrderRequest request) {
        Customer customer = requireCustomer(request.wechatId());
        TicketQuote quote = quoteService.requireQuote(request.quoteNo());
        ensureQuoteBelongsToCustomer(quote, customer);
        ensureLatestQuote(quote, customer);
        OrderResponse existingOrder = orderService.findOrderByQuoteNo(quote.getQuoteNo()).orElse(null);
        if (existingOrder != null) {
            if (!customer.getCustomerNo().equals(existingOrder.customerId())) {
                throw new BusinessException("existing order does not belong to current customer");
            }
            return existingOrder;
        }
        PaymentRecord paymentRecord = resolvePaymentRecord(request, customer);

        if (paymentRecord.getAmount().compareTo(quote.getTotalPrice()) < 0) {
            throw new BusinessException("confirmed payment amount is less than quote total price");
        }

        paymentRecord.setStatus(PaymentStatus.USED);
        paymentRecordRepository.save(paymentRecord);
        return orderService.createOrder(new CreateOrderRequest(
                quote.getQuoteNo(),
                customer.getCustomerNo(),
                paymentRecord.getPaymentRecordNo()
        ));
    }

    public OrderResponse getOrder(String orderNo) {
        return orderService.getOrder(orderNo);
    }

    private Customer upsertCustomer(String wechatId, String nickname, String avatarUrl) {
        Customer customer = findCustomerForUpdate(wechatId).orElseGet(() -> {
            Customer created = new Customer();
            created.setCustomerNo(newCustomerNo());
            created.setWechatId(wechatId);
            return created;
        });
        if (StringUtils.hasText(nickname)) {
            customer.setNickname(nickname);
        }
        if (StringUtils.hasText(avatarUrl)) {
            customer.setAvatarUrl(avatarUrl);
        }
        return customerRepository.save(customer);
    }

    private Customer requireCustomer(String wechatId) {
        return findCustomerForUpdate(wechatId)
                .orElseThrow(() -> new BusinessException("customer not found, please create quote first"));
    }

    private void ensureQuoteBelongsToCustomer(TicketQuote quote, Customer customer) {
        if (!customer.getCustomerNo().equals(quote.getCustomerId())) {
            throw new BusinessException("quote does not belong to current customer");
        }
    }

    private void ensureLatestQuote(TicketQuote quote, Customer customer) {
        if (!quote.getQuoteNo().equals(customer.getLatestQuoteNo())) {
            throw new BusinessException("quote is not the latest quote for current customer");
        }
    }

    private PaymentRecord resolvePaymentRecord(BotCreateOrderRequest request, Customer customer) {
        if (StringUtils.hasText(request.paymentRecordNo())) {
            PaymentRecord paymentRecord = findPaymentByRecordNo(request.paymentRecordNo())
                    .orElseThrow(() -> new BusinessException("payment record not found"));
            if (!customer.getCustomerNo().equals(paymentRecord.getCustomerNo())
                    || !request.quoteNo().equals(paymentRecord.getQuoteNo())) {
                throw new BusinessException("payment record does not match quote or customer");
            }
            if (paymentRecord.getStatus() != PaymentStatus.CONFIRMED) {
                throw new BusinessException("payment record is not confirmed");
            }
            return paymentRecord;
        }
        Long userId = UserScopeContext.get();
        return (userId == null
                ? paymentRecordRepository.findFirstByQuoteNoAndCustomerNoAndStatusOrderByConfirmedAtDesc(
                        request.quoteNo(), customer.getCustomerNo(), PaymentStatus.CONFIRMED)
                : paymentRecordRepository.findFirstByUserIdAndQuoteNoAndCustomerNoAndStatusOrderByConfirmedAtDesc(
                        userId, request.quoteNo(), customer.getCustomerNo(), PaymentStatus.CONFIRMED))
                .orElseThrow(() -> new BusinessException("confirmed payment record not found"));
    }

    private java.util.Optional<Customer> findCustomerForUpdate(String wechatId) {
        Long userId = UserScopeContext.get();
        return userId == null
                ? customerRepository.findByWechatIdForUpdate(wechatId)
                : customerRepository.findByUserIdAndWechatIdForUpdate(userId, wechatId);
    }

    private java.util.Optional<BotMessage> findBotMessage(String wechatId, String messageId) {
        Long userId = UserScopeContext.get();
        return userId == null
                ? botMessageRepository.findByWechatIdAndMessageId(wechatId, messageId)
                : botMessageRepository.findByUserIdAndWechatIdAndMessageId(userId, wechatId, messageId);
    }

    private java.util.Optional<PaymentRecord> findPaymentByExternalNo(String paymentNo) {
        Long userId = UserScopeContext.get();
        return userId == null
                ? paymentRecordRepository.findByPaymentNo(paymentNo)
                : paymentRecordRepository.findByUserIdAndPaymentNo(userId, paymentNo);
    }

    private java.util.Optional<PaymentRecord> findPaymentByRecordNo(String paymentRecordNo) {
        Long userId = UserScopeContext.get();
        return userId == null
                ? paymentRecordRepository.findByPaymentRecordNo(paymentRecordNo)
                : paymentRecordRepository.findByUserIdAndPaymentRecordNo(userId, paymentRecordNo);
    }

    private BotPaymentResponse toPaymentResponse(PaymentRecord paymentRecord) {
        return new BotPaymentResponse(
                paymentRecord.getPaymentRecordNo(),
                paymentRecord.getCustomerNo(),
                paymentRecord.getQuoteNo(),
                paymentRecord.getAmount(),
                paymentRecord.getStatus()
        );
    }

    private String newCustomerNo() {
        return "C" + DateTimeFormatter.ofPattern("yyyyMMddHHmmss").format(LocalDateTime.now())
                + UUID.randomUUID().toString().replace("-", "").substring(0, 8).toUpperCase();
    }

    private String newPaymentRecordNo() {
        return "P" + DateTimeFormatter.ofPattern("yyyyMMddHHmmss").format(LocalDateTime.now())
                + UUID.randomUUID().toString().replace("-", "").substring(0, 8).toUpperCase();
    }
}
