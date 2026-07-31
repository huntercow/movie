package com.movie.ticket.repository;

import com.movie.ticket.entity.XianyuFulfillmentStatus;
import com.movie.ticket.entity.XianyuPlatformOrder;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import jakarta.persistence.LockModeType;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface XianyuPlatformOrderRepository extends JpaRepository<XianyuPlatformOrder, Long> {
    Optional<XianyuPlatformOrder> findByPlatformOrderId(String platformOrderId);

    Optional<XianyuPlatformOrder> findByUserIdAndPlatformOrderId(Long userId, String platformOrderId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select platformOrder from XianyuPlatformOrder platformOrder where platformOrder.platformOrderId = :platformOrderId")
    Optional<XianyuPlatformOrder> findByPlatformOrderIdForUpdate(@Param("platformOrderId") String platformOrderId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select platformOrder from XianyuPlatformOrder platformOrder where platformOrder.userId = :userId and platformOrder.platformOrderId = :platformOrderId")
    Optional<XianyuPlatformOrder> findByUserIdAndPlatformOrderIdForUpdate(
            @Param("userId") Long userId,
            @Param("platformOrderId") String platformOrderId
    );

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select platformOrder from XianyuPlatformOrder platformOrder where platformOrder.chatId = :chatId and platformOrder.status in :statuses")
    List<XianyuPlatformOrder> findByChatIdAndStatusInForUpdate(
            @Param("chatId") String chatId,
            @Param("statuses") Collection<XianyuFulfillmentStatus> statuses
    );

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select platformOrder from XianyuPlatformOrder platformOrder where platformOrder.userId = :userId and platformOrder.chatId = :chatId and platformOrder.status in :statuses")
    List<XianyuPlatformOrder> findByUserIdAndChatIdAndStatusInForUpdate(
            @Param("userId") Long userId,
            @Param("chatId") String chatId,
            @Param("statuses") Collection<XianyuFulfillmentStatus> statuses
    );

    List<XianyuPlatformOrder> findByChatIdAndStatus(String chatId, XianyuFulfillmentStatus status);

    List<XianyuPlatformOrder> findByUserIdAndChatIdAndStatus(
            Long userId,
            String chatId,
            XianyuFulfillmentStatus status
    );

    List<XianyuPlatformOrder> findTop50ByStatusInOrderByUpdatedAtAsc(Collection<XianyuFulfillmentStatus> statuses);

    List<XianyuPlatformOrder> findTop50ByUserIdAndStatusInOrderByUpdatedAtAsc(
            Long userId,
            Collection<XianyuFulfillmentStatus> statuses
    );

    List<XianyuPlatformOrder> findTop100ByOrderByUpdatedAtDesc();

    List<XianyuPlatformOrder> findTop100ByUserIdOrderByUpdatedAtDesc(Long userId);

    List<XianyuPlatformOrder> findTop100ByStatusOrderByUpdatedAtDesc(XianyuFulfillmentStatus status);

    List<XianyuPlatformOrder> findTop100ByUserIdAndStatusOrderByUpdatedAtDesc(Long userId, XianyuFulfillmentStatus status);

    List<XianyuPlatformOrder> findTop100ByChatIdOrderByUpdatedAtDesc(String chatId);

    List<XianyuPlatformOrder> findTop100ByUserIdAndChatIdOrderByUpdatedAtDesc(Long userId, String chatId);

    List<XianyuPlatformOrder> findTop100ByChatIdAndStatusOrderByUpdatedAtDesc(String chatId, XianyuFulfillmentStatus status);

    List<XianyuPlatformOrder> findTop100ByUserIdAndChatIdAndStatusOrderByUpdatedAtDesc(
            Long userId,
            String chatId,
            XianyuFulfillmentStatus status
    );
}
