package com.movie.ticket.service;

import com.movie.ticket.entity.OrderStatus;
import com.movie.ticket.entity.TicketOrder;
import com.movie.ticket.exception.BusinessException;
import com.movie.ticket.repository.TicketOrderRepository;
import com.movie.ticket.security.UserScopeContext;
import com.movie.ticket.upstream.TicketUpstreamClient;
import com.movie.ticket.upstream.UpstreamOrderDetailResult;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.time.LocalDateTime;
import java.util.List;

@Service
public class OrderSyncService {

    private static final List<OrderStatus> SYNCABLE_STATUSES = List.of(
            OrderStatus.SUBMITTED,
            OrderStatus.WAIT_PAY,
            OrderStatus.PAID,
            OrderStatus.TICKETING
    );

    private final TicketOrderRepository orderRepository;
    private final TicketUpstreamClient upstreamClient;

    public OrderSyncService(TicketOrderRepository orderRepository, TicketUpstreamClient upstreamClient) {
        this.orderRepository = orderRepository;
        this.upstreamClient = upstreamClient;
    }

    @Scheduled(fixedDelayString = "${ticket.order-sync.fixed-delay:30000}")
    public void syncPendingOrders() {
        List<TicketOrder> orders = orderRepository.findTop50ByUpstreamOrderNoIsNotNullAndStatusInOrderByUpdatedAtAsc(SYNCABLE_STATUSES);
        for (TicketOrder order : orders) {
            try {
                UserScopeContext.set(order.getUserId());
                syncOrder(order.getOrderNo());
            } finally {
                UserScopeContext.clear();
            }
        }
    }

    @Transactional
    public TicketOrder syncOrder(String orderNo) {
        Long userId = UserScopeContext.get();
        TicketOrder order = (userId == null
                ? orderRepository.findByOrderNo(orderNo)
                : orderRepository.findByUserIdAndOrderNo(userId, orderNo))
                .orElseThrow(() -> new BusinessException("order not found"));
        if (!StringUtils.hasText(order.getUpstreamOrderNo())) {
            throw new BusinessException("missing upstream order number");
        }
        UpstreamOrderDetailResult detail = upstreamClient.getOrderDetail(order.getUpstreamOrderNo());
        applyDetail(order, detail);
        return orderRepository.save(order);
    }

    private void applyDetail(TicketOrder order, UpstreamOrderDetailResult detail) {
        LocalDateTime now = LocalDateTime.now();
        order.setUpstreamOrderId(detail.orderId());
        order.setUpstreamOrderStatus(detail.orderStatus());
        order.setUpstreamDetailResponse(detail.rawResponse());
        order.setLastSyncError(detail.lastSyncError());
        order.setLastSyncAt(now);

        Integer orderStatus = detail.orderStatus();
        if (orderStatus == null) {
            throw new BusinessException("upstream order detail is missing orderStatus");
        }
        switch (orderStatus) {
            case 1 -> order.setStatus(OrderStatus.WAIT_PAY);
            case 4 -> order.setStatus(OrderStatus.TICKETING);
            case 5 -> {
                if (!StringUtils.hasText(detail.ticketCodeInfo())) {
                    throw new BusinessException("issued upstream order is missing ticketCodeInfo");
                }
                order.setTicketCodeInfo(detail.ticketCodeInfo());
                order.setStatus(OrderStatus.ISSUED);
                if (order.getIssuedAt() == null) {
                    order.setIssuedAt(now);
                }
            }
            case 12 -> {
                order.setStatus(OrderStatus.REFUNDED);
                if (order.getRefundedAt() == null) {
                    order.setRefundedAt(now);
                }
            }
            default -> throw new BusinessException("unsupported upstream order status: " + orderStatus);
        }
    }
}
