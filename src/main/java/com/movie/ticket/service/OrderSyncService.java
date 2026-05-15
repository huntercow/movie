package com.movie.ticket.service;

import com.movie.ticket.entity.OrderStatus;
import com.movie.ticket.entity.TicketOrder;
import com.movie.ticket.exception.BusinessException;
import com.movie.ticket.repository.TicketOrderRepository;
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
                syncOrder(order.getOrderNo());
            } catch (Exception ignored) {
            }
        }
    }

    @Transactional
    public TicketOrder syncOrder(String orderNo) {
        TicketOrder order = orderRepository.findByOrderNo(orderNo).orElseThrow();
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

        if (StringUtils.hasText(detail.ticketCodeInfo())) {
            order.setTicketCodeInfo(detail.ticketCodeInfo());
        }

        Integer orderStatus = detail.orderStatus();
        if (orderStatus == null) {
            return;
        }
        if (orderStatus == 1) {
            order.setStatus(OrderStatus.WAIT_PAY);
        } else if (orderStatus == 4) {
            order.setStatus(OrderStatus.TICKETING);
        } else if (orderStatus == 5) {
            order.setStatus(OrderStatus.ISSUED);
            if (order.getIssuedAt() == null) {
                order.setIssuedAt(now);
            }
        } else if (orderStatus == 12) {
            order.setStatus(OrderStatus.REFUNDED);
            if (order.getRefundedAt() == null) {
                order.setRefundedAt(now);
            }
        }
    }
}
