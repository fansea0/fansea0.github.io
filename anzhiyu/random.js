var posts=["2024/06/05/AI/","2024/03/15/B树/","2024/06/01/Caffenie/","2023/10/21/Centos7安装Docker/","2024/06/07/Activi工作流/","2023/10/11/Dubbo/","2022/12/02/Git学习笔记/","2024/03/15/ELasticSearch/","2023/07/19/IDEA快捷键/","2024/03/16/InnoDb存储引擎/","2023/11/12/JUC并发编程/","2023/11/01/JVM虚拟机/","2024/03/09/Jmeter用法/","2023/10/16/Linux重要指令/","2024/07/08/MaxKB-卓越的AI驱动知识库构建与优化平台/","2023/10/16/Mybatis-Plus语法实现/","2024/03/23/MySQL/","2024/06/06/MybatisG/","2023/12/10/OAuth2登录协议/","2023/11/12/Redis笔记/","2024/07/06/QQ机器人/","2023/10/20/Redis高级/","2023/10/16/RabbitMQ/","2024/06/02/SHEIN之路/","2023/10/20/SpringSecurity-从入门到精通-三更草堂/","2024/04/14/Spring事务/","2023/11/08/Spring复习/","2024/03/04/Spring设计模式/","2024/05/22/influxDB/","2024/05/08/XYIOT项目学习笔记/","2023/12/02/java圣经/","2023/10/20/java进阶学习路线/","2023/10/16/python项目打包方法/","2023/10/16/java学习路线/","2024/05/08/shiro校验框架/","2023/10/16/typora快捷键/","2024/05/25/万物互联/","2024/07/05/xxl-job/","2024/04/20/专业好文/","2024/06/21/人工智能/","2024/03/16/人性的弱点/","2023/12/10/内网穿透cpolar/","2024/05/10/优秀开源笔记/","2024/04/25/前端学习/","2023/11/24/口才锻炼/","2024/05/08/反编译破解机器码/","2023/11/07/商品推荐算法/","2024/03/20/商机思考（一）/","2024/06/21/基于socket操作ABB机器人/","2023/10/22/安装elasticsearch/","2023/10/24/孵化商业IP/","2024/01/16/实习准备/","2024/05/27/实验课设/","2024/05/09/峰-终定律/","2024/03/06/布隆过滤器/","2023/12/10/常用依赖/","2023/10/25/微服务笔记/","2024/05/09/怎么讲好一个故事/","2023/10/17/我的车库/","2024/06/02/摄影大师/","2024/03/03/手写单例模式/","2023/11/09/数据结构/","2024/06/13/服务器运维/","2024/06/11/服务器管理/","2024/03/27/每日学习计划！/","2024/05/26/每日思考/","2024/07/04/淋巴测量/","2024/07/09/淋巴项目问题/","2024/07/10/淋巴测量数据库设计v1-0/","2023/10/16/湖科大小窝项目笔记/","2024/04/17/深度思考/","2024/04/20/温柔乡（CP匹配）项目架构/","2024/07/10/烤肠火鸡面：宿舍经济的王牌/","2023/12/01/电脑使用技巧/","2023/11/08/算法日记/","2024/07/05/若依/","2024/06/10/聊天室技术思考/","2024/07/08/计算机底层原理/","2023/10/20/计算机网络/","2024/02/28/蓝桥杯备赛/","2023/10/17/读书思考（一）/","2024/06/17/远程共享实验平台/","2023/12/06/资安学工考勤系统/","2024/03/15/面试精选/","2024/04/01/项目构建依赖/","2024/03/22/面试题随想录/","2024/03/20/高并发思想/","2023/10/15/黑马点评/","2024/07/16/My简历/","2024/07/16/MQ思考与总结/","2024/07/16/hexo搭建个人博客、/","2024/07/19/大话设计模式/","2024/07/28/基于go-cqHttp搭建的QQRobot/","2024/07/29/我的简历/","2024/07/26/简历投递/","2024/07/22/高效率修炼手册/","2024/08/12/操作系统/","2024/08/12/金融专家/"];function toRandomPost(){
    pjax.loadUrl('/'+posts[Math.floor(Math.random() * posts.length)]);
  };