package com.movie.ticket.repository;

import com.movie.ticket.entity.TicketOrder;
import com.movie.ticket.entity.OrderStatus;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import jakarta.persistence.LockModeType;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface TicketOrderRepository extends JpaRepository<TicketOrder, Long> {
    Optional<TicketOrder> findByOrderNo(String orderNo);

    Optional<TicketOrder> findByUserIdAndOrderNo(Long userId, String orderNo);

    Optional<TicketOrder> findByPaymentNo(String paymentNo);

    Optional<TicketOrder> findByUserIdAndPaymentNo(Long userId, String paymentNo);

    Optional<TicketOrder> findByQuoteNo(String quoteNo);

    Optional<TicketOrder> findByUserIdAndQuoteNo(Long userId, String quoteNo);

    List<TicketOrder> findTop100ByUserIdOrderByCreatedAtDesc(Long userId);

    List<TicketOrder> findTop200ByOrderByCreatedAtDesc();

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select ticketOrder from TicketOrder ticketOrder where ticketOrder.orderNo = :orderNo")
    Optional<TicketOrder> findByOrderNoForUpdate(@Param("orderNo") String orderNo);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select ticketOrder from TicketOrder ticketOrder where ticketOrder.userId = :userId and ticketOrder.orderNo = :orderNo")
    Optional<TicketOrder> findByUserIdAndOrderNoForUpdate(
            @Param("userId") Long userId,
            @Param("orderNo") String orderNo
    );

    List<TicketOrder> findTop50ByUpstreamOrderNoIsNotNullAndStatusInOrderByUpdatedAtAsc(Collection<OrderStatus> statuses);
}
