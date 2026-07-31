package com.movie.ticket.repository;

import com.movie.ticket.entity.Customer;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Optional;

public interface CustomerRepository extends JpaRepository<Customer, Long> {
    Optional<Customer> findByWechatId(String wechatId);

    Optional<Customer> findByUserIdAndWechatId(Long userId, String wechatId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select customer from Customer customer where customer.wechatId = :wechatId")
    Optional<Customer> findByWechatIdForUpdate(@Param("wechatId") String wechatId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select customer from Customer customer where customer.userId = :userId and customer.wechatId = :wechatId")
    Optional<Customer> findByUserIdAndWechatIdForUpdate(
            @Param("userId") Long userId,
            @Param("wechatId") String wechatId
    );

    Optional<Customer> findByCustomerNo(String customerNo);

    Optional<Customer> findByUserIdAndCustomerNo(Long userId, String customerNo);
}
