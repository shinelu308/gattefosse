/**
 * 嘉法狮前端 API 服务层（ES5 兼容版）
 * 统一封装所有后端 API 调用，替代旧的 Drupal API 路径
 * 后端地址: http://localhost:3000
 */

(function (global) {
  var BASE_URL = 'http://localhost:3000';

  // 创建 axios 实例
  var http = axios.create({
    baseURL: BASE_URL,
    timeout: 15000,
    headers: { 'Content-Type': 'application/json' }
  });

  // 请求拦截器 — 自动附加 JWT Token
  http.interceptors.request.use(function (config) {
    var token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = 'Bearer ' + token;
    }
    return config;
  }, function (error) {
    return Promise.reject(error);
  });

  // 响应拦截器 — 统一处理 code:0 格式，将业务数据提取到 response.data
  http.interceptors.response.use(function (response) {
    var body = response.data;
    if (body && body.code === 0) {
      response.data = body.data;
      return response;
    }
    if (body && body.code !== undefined && body.code !== 0) {
      return Promise.reject(new Error(body.message || '请求失败'));
    }
    return response;
  }, function (error) {
    if (error.response && error.response.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      localStorage.setItem('isLoggedIn', 'false');
    }
    return Promise.reject(error);
  });

  // ==================== Auth 认证 ====================
  var AuthAPI = {
    login: function (email, password) {
      return http.post('/api/auth/login', { email: email, password: password });
    },
    register: function (data) {
      return http.post('/api/auth/register', data);
    },
    me: function () {
      return http.get('/api/auth/me');
    }
  };

  // ==================== PC 产品（个人护理原料）====================
  var PcProductAPI = {
    list: function (params) {
      return http.get('/api/pc-ingredients', { params: params });
    },
    detail: function (id) {
      return http.get('/api/pc-ingredients/' + id);
    },
    related: function (id) {
      return http.get('/api/pc-ingredients/' + id + '/related');
    }
  };

  // ==================== Pharma 产品（药用辅料）====================
  var PharmaProductAPI = {
    list: function (params) {
      return http.get('/api/pharma-products', { params: params });
    },
    detail: function (id) {
      return http.get('/api/pharma-products/' + id);
    },
    blocks: function (productId) {
      return http.get('/api/blocks', { params: { productId: productId, productType: 'pharma' } });
    },
    documents: function (productId) {
      return http.get('/api/pharma-products/' + productId + '/documents');
    }
  };

  // ==================== 配方 Formulations ====================
  var FormulationAPI = {
    list: function (params) {
      return http.get('/api/formulations', { params: params });
    },
    detail: function (id) {
      return http.get('/api/formulations/' + id);
    }
  };

  // ==================== 文档 Documents ====================
  var DocumentAPI = {
    list: function (params) {
      return http.get('/api/documents', { params: params });
    },
    detail: function (id) {
      return http.get('/api/documents/' + id);
    }
  };

  // ==================== 新闻 News ====================
  var NewsAPI = {
    list: function (params) {
      return http.get('/api/news', { params: params });
    },
    detail: function (id) {
      return http.get('/api/news/' + id);
    }
  };

  // ==================== 标签 Tags ====================
  var TagAPI = {
    list: function (params) {
      return http.get('/api/tags', { params: params });
    }
  };

  // ==================== 收藏 Favorites ====================
  var FavoriteAPI = {
    list: function (params) {
      return http.get('/api/favorites', { params: params });
    },
    add: function (data) {
      return http.post('/api/favorites', data);
    },
    remove: function (id) {
      return http.delete('/api/favorites/' + id);
    }
  };

  // ==================== 购物车 Cart ====================
  var CartAPI = {
    list: function (params) {
      return http.get('/api/cart', { params: params });
    },
    add: function (data) {
      return http.post('/api/cart', data);
    },
    update: function (id, data) {
      return http.put('/api/cart/' + id, data);
    },
    remove: function (id) {
      return http.delete('/api/cart/' + id);
    },
    count: function () {
      return http.get('/api/cart/count');
    },
    clear: function () {
      return http.delete('/api/cart');
    }
  };

  // ==================== 订单 Orders ====================
  var OrderAPI = {
    list: function (params) {
      return http.get('/api/orders', { params: params });
    },
    detail: function (id) {
      return http.get('/api/orders/' + id);
    },
    create: function (data) {
      return http.post('/api/orders', data);
    },
    submitFeedback: function (data) {
      return http.post('/api/orders/feedback', data);
    }
  };

  // ==================== 站点内容 Content ====================
  var ContentAPI = {
    pages: function (params) {
      return http.get('/api/content', { params: params });
    },
    subsidiaries: function () {
      return http.get('/api/content/subsidiaries');
    }
  };

  // ==================== 求职 Career ====================
  var CareerAPI = {
    create: function (data) {
      return http.post('/api/careers', data);
    },
    list: function () {
      return http.get('/api/careers');
    }
  };

  // ==================== 全局搜索 Search ====================
  var SearchAPI = {
    all: function (keyword) {
      return http.get('/api/search', { params: { keyword: keyword } });
    },
    products: function (keyword) {
      return Promise.all([
        http.get('/api/pc-ingredients', { params: { keyword: keyword, limit: 10 } }),
        http.get('/api/pharma-products', { params: { keyword: keyword, limit: 10 } })
      ]).then(function (results) {
        return { pc: results[0].data, pharma: results[1].data };
      });
    },
    news: function (keyword) {
      return http.get('/api/news', { params: { keyword: keyword } });
    }
  };

  // ==================== 用户管理（后台）====================
  var UserAdminAPI = {
    list: function (params) {
      return http.get('/api/admin/users', { params: params });
    },
    detail: function (id) {
      return http.get('/api/admin/users/' + id);
    },
    create: function (data) {
      return http.post('/api/admin/users', data);
    },
    update: function (id, data) {
      return http.put('/api/admin/users/' + id, data);
    },
    delete: function (id) {
      return http.delete('/api/admin/users/' + id);
    }
  };

  // ==================== 设置（后台）====================
  var SettingAPI = {
    get: function () {
      return http.get('/api/settings');
    },
    save: function (data) {
      return http.put('/api/settings', data);
    }
  };

  // ==================== 内容区块 ====================
  var BlocksAPI = {
    list: function (params) {
      return http.get('/api/blocks', { params: params });
    }
  };

  // ==================== 导出全局对象 ====================
  global.GatteAPI = {
    http: http,
    BASE_URL: BASE_URL,
    Auth: AuthAPI,
    PcProduct: PcProductAPI,
    PharmaProduct: PharmaProductAPI,
    Formulation: FormulationAPI,
    Document: DocumentAPI,
    News: NewsAPI,
    Tag: TagAPI,
    Favorite: FavoriteAPI,
    Cart: CartAPI,
    Order: OrderAPI,
    Content: ContentAPI,
    Career: CareerAPI,
    Blocks: BlocksAPI,
    Search: SearchAPI,
    UserAdmin: UserAdminAPI,
    Setting: SettingAPI
  };

})(window);
